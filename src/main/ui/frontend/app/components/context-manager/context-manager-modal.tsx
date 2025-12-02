import React, { useState, useEffect, useCallback } from 'react';
import { getContextFiles, removeContextFiles, getAllProjectFiles, addContextFiles } from '../../api/api-client.js';
import {
  ModalOverlay,
  ModalContainer,
  ModalHeader,
  CloseButton,
  ModalContent,
  TreeContainer,
  TreeNodeItem,
  Indent,
  Checkbox,
  NodeLabel,
  ButtonGroup,
  Button,
  EmptyState,
  StatsBar,
  SizeIndicator,
  SearchInput,
  CollapseIcon,
  NodeLabelContainer,
  ContextBadge,
  FilterBar,
  FilterLabel,
} from './context-manager-modal-styles.js';
import {
  buildTree,
  toggleNode,
  updateNodeState,
  collectCheckedFiles,
  TreeNode,
  formatTokenCount,
  getSizeCategory,
  toggleCollapse,
  filterTree,
  expandParentsOfMatches,
  propagateContextStatus,
  sortTree,
} from './tree-utils.js';
import { useChatState } from '../../contexts/chat-state-context.js';

export const ContextManagerModal: React.FC = () => {
  const { isContextManagerOpen, toggleContextManager } = useChatState();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [, setTotalFiles] = useState(0); // Total files in context (legacy name, now contextFilesCount)
  const [projectFilesCount, setProjectFilesCount] = useState(0);
  const [contextFilesCount, setContextFilesCount] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState<string>('Loading...');
  const [searchQuery, setSearchQuery] = useState('');
  const [showOnlyInContext, setShowOnlyInContext] = useState(true);
  const [, setAllProjectFiles] = useState<string[]>([]);

  const fetchContextFiles = useCallback(async () => {
    setLoading(true);
    setLoadingMessage('Fetching files...');
    try {
      const [contextFiles, projectFiles] = await Promise.all([getContextFiles(), getAllProjectFiles()]);

      setAllProjectFiles(projectFiles);
      setProjectFilesCount(projectFiles.length);
      setContextFilesCount(contextFiles.length);
      setTotalFiles(contextFiles.length); // Keep for compatibility if needed

      setLoadingMessage('Processing files...');

      const tokenMap: Record<string, number> = {};
      const contextFilePaths = new Set<string>();
      let calculatedTotal = 0;

      for (const file of contextFiles) {
        tokenMap[file.path] = file.tokenCount;
        contextFilePaths.add(file.path);
        calculatedTotal += file.tokenCount;
      }

      setTotalTokens(calculatedTotal);

      // Build tree with ALL project files
      const newTree = buildTree(projectFiles, tokenMap);

      // Mark files as inContext
      const markContextFiles = (nodes: TreeNode[]) => {
        for (const node of nodes) {
          if (node.type === 'file') {
            node.inContext = contextFilePaths.has(node.path);
          } else if (node.children) {
            markContextFiles(node.children);
          }
        }
      };
      markContextFiles(newTree);

      // Propagate context status to folders (for sorting/filtering)
      propagateContextStatus(newTree);

      // Sort tree: In-context first, then folders, then name
      sortTree(newTree);

      // Apply current search filter and context filter
      filterTree(newTree, searchQuery, showOnlyInContext);

      if (searchQuery || showOnlyInContext) {
        expandParentsOfMatches(newTree, searchQuery);
      }

      setTree(newTree);
      setSelectedCount(0);
    } catch (error) {
      console.error('Failed to fetch context files:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, showOnlyInContext]);

  useEffect(() => {
    if (isContextManagerOpen) {
      fetchContextFiles();
    }
  }, [isContextManagerOpen, fetchContextFiles]);

  const handleClose = () => {
    setSearchQuery(''); // Clear search on close
    setShowOnlyInContext(true); // Reset filter on close to default
    toggleContextManager();
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    const newTree = [...tree];
    filterTree(newTree, query, showOnlyInContext);
    if (query || showOnlyInContext) {
      expandParentsOfMatches(newTree, query);
    }
    setTree(newTree);
  };

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setShowOnlyInContext(checked);

    const newTree = [...tree];
    filterTree(newTree, searchQuery, checked);
    if (searchQuery || checked) {
      expandParentsOfMatches(newTree, searchQuery);
    }
    setTree(newTree);
  };

  const handleCollapseToggle = (node: TreeNode) => {
    toggleCollapse(node);
    setTree([...tree]); // Trigger re-render
  };

  const handleToggleNode = (node: TreeNode) => {
    const newCheckedState = !node.checked;
    toggleNode(node, newCheckedState);

    // Re-calculate indeterminate states from root
    const updateTreeState = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children) {
          updateTreeState(n.children);
          updateNodeState(n);
        }
      }
    };

    const newTree = [...tree];
    updateTreeState(newTree);
    setTree(newTree);

    const checkedFiles = collectCheckedFiles(newTree);
    setSelectedCount(checkedFiles.length);
  };

  const handleAddSelected = async () => {
    const checkedFiles = collectCheckedFiles(tree);
    // Filter for files NOT in context
    const filesToAdd = [];
    const findNode = (nodes: TreeNode[], path: string): TreeNode | undefined => {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return undefined;
    };

    for (const path of checkedFiles) {
      const node = findNode(tree, path);
      if (node && !node.inContext) {
        filesToAdd.push(path);
      }
    }

    if (filesToAdd.length === 0) return;

    if (!confirm(`Are you sure you want to add ${filesToAdd.length} files to the context?`)) {
      return;
    }

    setLoading(true);
    setLoadingMessage('Adding files...');
    try {
      const result = await addContextFiles(filesToAdd);
      console.log('Context addition result:', result);
      await fetchContextFiles();
    } catch (error) {
      console.error('Failed to add context files:', error);
      alert('Failed to add files. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveSelected = async () => {
    const checkedFiles = collectCheckedFiles(tree);
    // Filter for files IN context
    const filesToRemove = [];
    const findNode = (nodes: TreeNode[], path: string): TreeNode | undefined => {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return undefined;
    };

    for (const path of checkedFiles) {
      const node = findNode(tree, path);
      if (node && node.inContext) {
        filesToRemove.push(path);
      }
    }

    if (filesToRemove.length === 0) return;

    if (!confirm(`Are you sure you want to remove ${filesToRemove.length} files from the context?`)) {
      return;
    }

    setLoading(true);
    setLoadingMessage('Removing files...');
    try {
      const result = await removeContextFiles(filesToRemove);
      console.log('Context removal result:', result);
      await fetchContextFiles();
    } catch (error) {
      console.error('Failed to remove context files:', error);
      alert('Failed to remove files. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const renderTreeNodes = (nodes: TreeNode[], level = 0) => {
    return nodes.map((node) => {
      if (node.visible === false) return null;

      return (
        <React.Fragment key={node.path}>
          <TreeNodeItem>
            <Indent level={level} />
            {node.type === 'folder' ? (
              <CollapseIcon onClick={() => handleCollapseToggle(node)}>{node.collapsed ? '▶' : '▼'}</CollapseIcon>
            ) : (
              <span style={{ width: '16px', display: 'inline-block' }}></span>
            )}
            <Checkbox
              checked={node.checked || false}
              ref={(input) => {
                if (input) input.indeterminate = node.indeterminate || false;
              }}
              onChange={() => handleToggleNode(node)}
            />
            <NodeLabelContainer
              onClick={() => (node.type === 'folder' ? handleCollapseToggle(node) : handleToggleNode(node))}
            >
              <NodeLabel type={node.type} title={node.path}>
                {node.type === 'folder' ? '📁 ' : '📄 '}
                {node.name}
              </NodeLabel>
              {node.type === 'file' && node.inContext && !showOnlyInContext && <ContextBadge>In Context</ContextBadge>}
              {node.type === 'file' &&
                node.inContext &&
                node.aggregatedTokenCount !== undefined &&
                node.aggregatedTokenCount > 0 && (
                  <SizeIndicator category={getSizeCategory(node.aggregatedTokenCount)}>
                    ({node.formattedSize})
                  </SizeIndicator>
                )}
            </NodeLabelContainer>
          </TreeNodeItem>
          {node.children && !node.collapsed && renderTreeNodes(node.children, level + 1)}
        </React.Fragment>
      );
    });
  };

  // Helper to count selected files by context status for button states
  const getSelectedCounts = () => {
    const checkedFiles = collectCheckedFiles(tree);
    let inContextCount = 0;
    let notInContextCount = 0;

    const findNode = (nodes: TreeNode[], path: string): TreeNode | undefined => {
      for (const node of nodes) {
        if (node.path === path) return node;
        if (node.children) {
          const found = findNode(node.children, path);
          if (found) return found;
        }
      }
      return undefined;
    };

    for (const path of checkedFiles) {
      const node = findNode(tree, path);
      if (node) {
        if (node.inContext) inContextCount++;
        else notInContextCount++;
      }
    }
    return { inContextCount, notInContextCount };
  };

  const { inContextCount, notInContextCount } = getSelectedCounts();

  if (!isContextManagerOpen) return null;

  return (
    <ModalOverlay onClick={handleClose}>
      <ModalContainer onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <h2>Manage Context Files</h2>
          <CloseButton onClick={handleClose}>&times;</CloseButton>
        </ModalHeader>
        <ModalContent>
          <StatsBar>
            <span>Total Project Files: {projectFilesCount}</span>
            <span>In Context: {contextFilesCount}</span>
            <span>Selected: {selectedCount}</span>
            {totalTokens > 0 && <span>Total Context Size: {formatTokenCount(totalTokens)}</span>}
          </StatsBar>

          <SearchInput placeholder="Search files..." value={searchQuery} onChange={handleSearch} autoFocus />

          <FilterBar>
            <FilterLabel>
              <Checkbox checked={showOnlyInContext} onChange={handleFilterChange} />
              Show only in context
            </FilterLabel>
          </FilterBar>

          <TreeContainer>
            {loading ? (
              <EmptyState>{loadingMessage}</EmptyState>
            ) : tree.length > 0 ? (
              renderTreeNodes(tree)
            ) : (
              <EmptyState>No files found.</EmptyState>
            )}
          </TreeContainer>

          <ButtonGroup>
            <Button onClick={fetchContextFiles} disabled={loading}>
              Refresh
            </Button>
            <Button variant="primary" onClick={handleAddSelected} disabled={loading || notInContextCount === 0}>
              Add Selected
            </Button>
            <Button variant="danger" onClick={handleRemoveSelected} disabled={loading || inContextCount === 0}>
              Remove Selected
            </Button>
            <Button onClick={handleClose}>Close</Button>
          </ButtonGroup>
        </ModalContent>
      </ModalContainer>
    </ModalOverlay>
  );
};

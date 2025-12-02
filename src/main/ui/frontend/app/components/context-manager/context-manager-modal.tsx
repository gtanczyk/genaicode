import React, { useState, useEffect, useCallback } from 'react';
import { getContextFiles, removeContextFiles } from '../../api/api-client.js';
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
} from './context-manager-modal-styles.js';
import {
  buildTree,
  toggleNode,
  updateNodeState,
  collectCheckedFiles,
  TreeNode,
  formatTokenCount,
  getSizeCategory,
} from './tree-utils.js';
import { useChatState } from '../../contexts/chat-state-context.js';

export const ContextManagerIcon = () => <span>📂</span>;

export const ContextManagerModal: React.FC = () => {
  const { isContextManagerOpen, toggleContextManager } = useChatState();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState<string>('Loading...');

  const fetchContextFiles = useCallback(async () => {
    setLoading(true);
    setLoadingMessage('Fetching files...');
    try {
      const contextFiles = await getContextFiles();
      setTotalFiles(contextFiles.length);

      setLoadingMessage('Calculating sizes...');

      const tokenMap: Record<string, number> = {};
      const filePaths: string[] = [];
      let calculatedTotal = 0;

      for (const file of contextFiles) {
        tokenMap[file.path] = file.tokenCount;
        filePaths.push(file.path);
        calculatedTotal += file.tokenCount;
      }

      setTotalTokens(calculatedTotal);

      const newTree = buildTree(filePaths, tokenMap);
      setTree(newTree);
      setSelectedCount(0);
    } catch (error) {
      console.error('Failed to fetch context files:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isContextManagerOpen) {
      fetchContextFiles();
    }
  }, [isContextManagerOpen, fetchContextFiles]);

  const handleClose = () => {
    toggleContextManager();
  };

  const handleToggleNode = (node: TreeNode) => {
    const newCheckedState = !node.checked;
    toggleNode(node, newCheckedState);

    // Re-calculate indeterminate states from root
    // Since we don't have parent pointers, we rebuild state for the whole tree
    // This is acceptable for reasonable tree sizes
    const updateTreeState = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if (n.children) {
          updateTreeState(n.children);
          updateNodeState(n);
        }
      }
    };

    // Create a shallow copy to trigger re-render
    const newTree = [...tree];
    updateTreeState(newTree);
    setTree(newTree);

    const checkedFiles = collectCheckedFiles(newTree);
    setSelectedCount(checkedFiles.length);
  };

  const handleRemoveSelected = async () => {
    const filesToRemove = collectCheckedFiles(tree);
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
    return nodes.map((node) => (
      <React.Fragment key={node.path}>
        <TreeNodeItem>
          <Indent level={level} />
          <Checkbox
            checked={node.checked || false}
            ref={(input) => {
              if (input) input.indeterminate = node.indeterminate || false;
            }}
            onChange={() => handleToggleNode(node)}
          />
          <NodeLabel type={node.type} onClick={() => handleToggleNode(node)} title={node.path}>
            {node.type === 'folder' ? '📁 ' : '📄 '}
            {node.name}
            {node.aggregatedTokenCount !== undefined && node.aggregatedTokenCount > 0 && (
              <SizeIndicator category={getSizeCategory(node.aggregatedTokenCount)}>
                ({node.formattedSize})
              </SizeIndicator>
            )}
          </NodeLabel>
        </TreeNodeItem>
        {node.children && renderTreeNodes(node.children, level + 1)}
      </React.Fragment>
    ));
  };

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
            <span>Total Files: {totalFiles}</span>
            <span>Selected: {selectedCount}</span>
            {totalTokens > 0 && <span>Total Size: {formatTokenCount(totalTokens)}</span>}
          </StatsBar>

          <TreeContainer>
            {loading ? (
              <EmptyState>{loadingMessage}</EmptyState>
            ) : tree.length > 0 ? (
              renderTreeNodes(tree)
            ) : (
              <EmptyState>No files in context.</EmptyState>
            )}
          </TreeContainer>

          <ButtonGroup>
            <Button onClick={fetchContextFiles} disabled={loading}>
              Refresh
            </Button>
            <Button variant="danger" onClick={handleRemoveSelected} disabled={loading || selectedCount === 0}>
              Remove Selected
            </Button>
            <Button onClick={handleClose}>Close</Button>
          </ButtonGroup>
        </ModalContent>
      </ModalContainer>
    </ModalOverlay>
  );
};

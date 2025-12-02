export type TreeNode = {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: TreeNode[];
  checked?: boolean;
  indeterminate?: boolean;
  tokenCount?: number;
  aggregatedTokenCount?: number;
  formattedSize?: string;
  collapsed?: boolean;
  visible?: boolean;
  inContext?: boolean;
  containsContext?: boolean;
};

/**
 * Formats a token count into a human-readable string.
 */
export function formatTokenCount(count: number): string {
  if (count < 1000) {
    return `${count} tokens`;
  }
  if (count < 1000000) {
    return `${(count / 1000).toFixed(1)}K tokens`;
  }
  return `${(count / 1000000).toFixed(1)}M tokens`;
}

/**
 * Determines the size category based on token count.
 */
export function getSizeCategory(tokens: number): 'small' | 'medium' | 'large' {
  if (tokens < 10000) {
    return 'small';
  }
  if (tokens < 100000) {
    return 'medium';
  }
  return 'large';
}

/**
 * Recursively calculates aggregated token counts for a node and its children.
 */
export function calculateNodeSizes(node: TreeNode, tokenMap: Record<string, number>): void {
  if (node.type === 'file') {
    const tokens = tokenMap[node.path] || 0;
    node.tokenCount = tokens;
    node.aggregatedTokenCount = tokens;
  } else if (node.children) {
    let total = 0;
    for (const child of node.children) {
      calculateNodeSizes(child, tokenMap);
      total += child.aggregatedTokenCount || 0;
    }
    node.aggregatedTokenCount = total;
  } else {
    node.aggregatedTokenCount = 0;
  }

  node.formattedSize = formatTokenCount(node.aggregatedTokenCount || 0);
}

/**
 * Builds a hierarchical tree structure from a list of absolute file paths.
 * Automatically strips the common root directory to avoid unnecessary indentation.
 * Returns the tree nodes and the detected root path.
 */
export function buildTree(paths: string[], tokenMap?: Record<string, number>): { nodes: TreeNode[]; rootPath: string } {
  const root: TreeNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Sort paths to ensure deterministic tree structure
  const sortedPaths = [...paths].sort();

  // 1. Find common prefix
  const splitPaths = sortedPaths.map((p) => p.split('/').filter((x) => x.length > 0));
  let commonPrefix: string[] = [];

  if (splitPaths.length > 0) {
    commonPrefix = [...splitPaths[0]];
    // Assume the last part of the first path is a file, so it can't be a common folder prefix
    commonPrefix.pop();

    for (let i = 1; i < splitPaths.length; i++) {
      const parts = splitPaths[i];
      let j = 0;
      while (j < commonPrefix.length && j < parts.length - 1 && parts[j] === commonPrefix[j]) {
        j++;
      }
      commonPrefix = commonPrefix.slice(0, j);
      if (commonPrefix.length === 0) break;
    }
  }

  const prefixPath = commonPrefix.length > 0 ? '/' + commonPrefix.join('/') : '';

  // 2. Build tree using relative paths
  for (let i = 0; i < sortedPaths.length; i++) {
    const parts = splitPaths[i];
    // Skip common prefix parts
    const relativeParts = parts.slice(commonPrefix.length);

    let currentNode = root;
    let currentPath = prefixPath;

    for (let j = 0; j < relativeParts.length; j++) {
      const part = relativeParts[j];
      const isFile = j === relativeParts.length - 1;
      currentPath += '/' + part;

      let child = currentNode.children?.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: currentPath, // Preserves the full absolute path
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : [],
          checked: false,
          indeterminate: false,
          collapsed: false,
          visible: true,
          inContext: false,
        };
        currentNode.children = currentNode.children || [];
        currentNode.children.push(child);
      }

      currentNode = child;
    }
  }

  const nodes = root.children || [];

  if (tokenMap) {
    for (const node of nodes) {
      calculateNodeSizes(node, tokenMap);
    }
  }

  return { nodes, rootPath: prefixPath };
}

/**
 * Toggles the collapsed state of a folder node.
 */
export function toggleCollapse(node: TreeNode): void {
  if (node.type === 'folder') {
    node.collapsed = !node.collapsed;
  }
}

/**
 * Filters the tree nodes based on a search query and context status.
 * Sets the 'visible' property of each node.
 */
export function filterTree(nodes: TreeNode[], searchQuery: string, showOnlyInContext: boolean = false): void {
  const query = searchQuery.toLowerCase();

  for (const node of nodes) {
    // 1. Determine if node itself matches criteria
    const nameMatches = !searchQuery || node.name.toLowerCase().includes(query);
    const contextMatches = !showOnlyInContext || (node.type === 'file' && !!node.inContext);

    if (node.children) {
      // Recurse
      filterTree(node.children, searchQuery, showOnlyInContext);
      const anyChildVisible = node.children.some((c) => c.visible);

      if (showOnlyInContext) {
        // If filtering by context, folder is visible only if it has visible children.
        node.visible = anyChildVisible;
      } else {
        // Normal search: visible if name matches OR children match
        node.visible = nameMatches || anyChildVisible;
      }
    } else {
      // File
      node.visible = nameMatches && contextMatches;
    }
  }
}

/**
 * Auto-expands folders that contain matching descendants.
 * Returns true if the subtree contains visible nodes.
 */
export function expandParentsOfMatches(nodes: TreeNode[], searchQuery: string): boolean {
  // If we are filtering (either by search or context), we generally want to expand to show results.
  // This function is named expandParentsOfMatches but effectively expands parents of visible nodes.
  // We can rely on 'visible' property set by filterTree.

  let subtreeHasVisible = false;

  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.visible) {
        subtreeHasVisible = true;
      }
    } else {
      // Folder
      if (node.children) {
        const childrenHasVisible = expandParentsOfMatches(node.children, searchQuery);
        if (childrenHasVisible) {
          node.collapsed = false;
          subtreeHasVisible = true;
        }
        // If the folder itself is visible (matched name), it contributes to parent visibility
        if (node.visible) {
          subtreeHasVisible = true;
        }
      }
    }
  }
  return subtreeHasVisible;
}

/**
 * Toggles the checked state of a node and propagates it to all descendants.
 * Only affects visible nodes.
 */
export function toggleNode(node: TreeNode, checked: boolean): void {
  if (node.visible === false) return;

  node.checked = checked;
  node.indeterminate = false;

  if (node.children) {
    for (const child of node.children) {
      toggleNode(child, checked);
    }
  }
}

/**
 * Updates the checked/indeterminate state of a node based on its children.
 * Should be called after modifying children states.
 * Only considers visible children.
 * Returns the updated node state.
 */
export function updateNodeState(node: TreeNode): void {
  if (!node.children || node.children.length === 0) {
    return;
  }

  let allChecked = true;
  let someChecked = false;
  let someIndeterminate = false;
  let visibleChildrenCount = 0;

  for (const child of node.children) {
    // Recursively update children first (bottom-up)
    if (child.type === 'folder') {
      updateNodeState(child);
    }

    if (child.visible === false) continue;
    visibleChildrenCount++;

    if (!child.checked) allChecked = false;
    if (child.checked) someChecked = true;
    if (child.indeterminate) someIndeterminate = true;
  }

  if (visibleChildrenCount > 0) {
    node.checked = allChecked;
    node.indeterminate = !allChecked && (someChecked || someIndeterminate);
  }
}

/**
 * Collects all checked file paths from the tree.
 */
export function collectCheckedFiles(nodes: TreeNode[]): string[] {
  const files: string[] = [];

  function traverse(node: TreeNode) {
    if (node.type === 'file' && node.checked) {
      files.push(node.path);
    }
    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return files;
}

/**
 * Recursively determines if folders contain any "in context" files.
 * Sets `containsContext` property on folder nodes.
 */
export function propagateContextStatus(nodes: TreeNode[]): void {
  for (const node of nodes) {
    if (node.children) {
      propagateContextStatus(node.children);
      // Folder contains context if any child is in context or contains context
      node.containsContext = node.children.some((c) => c.inContext || c.containsContext);
    }
  }
}

/**
 * Sorts the tree nodes.
 * Priority:
 * 1. In Context / Contains Context (true first)
 * 2. Folder vs File (Folders first)
 * 3. Name (Alphabetical)
 */
export function sortTree(nodes: TreeNode[]): void {
  // Sort children
  nodes.sort((a, b) => {
    // Priority 1: In Context / Contains Context
    const aHasContext = a.inContext || a.containsContext;
    const bHasContext = b.inContext || b.containsContext;

    if (aHasContext !== bHasContext) {
      return aHasContext ? -1 : 1;
    }

    // Priority 2: Folder vs File (Folders first)
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    // Priority 3: Name
    return a.name.localeCompare(b.name);
  });

  // Recurse
  for (const node of nodes) {
    if (node.children) {
      sortTree(node.children);
    }
  }
}

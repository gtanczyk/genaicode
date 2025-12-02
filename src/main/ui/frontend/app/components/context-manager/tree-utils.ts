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
 * Assumes paths are absolute and use '/' as separator.
 * Optionally accepts a map of file paths to token counts to populate size information.
 */
export function buildTree(paths: string[], tokenMap?: Record<string, number>): TreeNode[] {
  const root: TreeNode = { name: 'root', path: '', type: 'folder', children: [] };

  // Sort paths to ensure deterministic tree structure
  const sortedPaths = [...paths].sort();

  for (const filePath of sortedPaths) {
    // Remove leading slash for splitting, but keep full path for node
    const parts = filePath.split('/').filter((p) => p.length > 0);
    let currentNode = root;
    let currentPath = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      currentPath += '/' + part;

      let child = currentNode.children?.find((c) => c.name === part);

      if (!child) {
        child = {
          name: part,
          path: currentPath,
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : [],
          checked: false,
          indeterminate: false,
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

  return nodes;
}

/**
 * Toggles the checked state of a node and propagates it to all descendants.
 */
export function toggleNode(node: TreeNode, checked: boolean): void {
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
 * Returns the updated node state.
 */
export function updateNodeState(node: TreeNode): void {
  if (!node.children || node.children.length === 0) {
    return;
  }

  let allChecked = true;
  let someChecked = false;
  let someIndeterminate = false;

  for (const child of node.children) {
    // Recursively update children first (bottom-up)
    if (child.type === 'folder') {
      updateNodeState(child);
    }

    if (!child.checked) allChecked = false;
    if (child.checked) someChecked = true;
    if (child.indeterminate) someIndeterminate = true;
  }

  node.checked = allChecked;
  node.indeterminate = !allChecked && (someChecked || someIndeterminate);
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

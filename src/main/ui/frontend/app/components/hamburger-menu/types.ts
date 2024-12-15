import { ReactNode } from 'react';

/**
 * Interface for menu item configuration
 */
export interface MenuItem {
  /** The content to be rendered for this menu item */
  content: ReactNode;
  /** Optional aria label for accessibility */
  ariaLabel?: string;
  /** Click handler for the menu item */
  onClick: () => void;
  /** Optional key for the menu item */
  key?: string;
}

/**
 * Props for the HamburgerMenu component
 */
export interface HamburgerMenuProps {
  /** Array of menu items to be rendered */
  menuItems: MenuItem[];
  /** Whether the menu is currently open */
  isOpen: boolean;
  /** Function to handle opening/closing the menu */
  onToggle: () => void;
  /** Optional class name for styling */
  className?: string;
  /** Optional aria label for the menu button */
  buttonAriaLabel?: string;
  /** Optional aria label for the menu */
  menuAriaLabel?: string;
  /** Optional position configuration */
  position?: {
    top?: number | string;
    right?: number | string;
    left?: number | string;
    bottom?: number | string;
  };
}

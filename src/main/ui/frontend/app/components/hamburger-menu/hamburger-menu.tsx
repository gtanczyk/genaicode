import React, { useEffect, useRef, KeyboardEvent } from 'react';
import { HamburgerMenuProps } from './types';
import { MenuButton, MenuBackdrop, MenuContainer, MenuItem, MenuWrapper } from './styles';

const GITHUB_ISSUES_URL = 'https://github.com/gtanczyk/genaicode/issues';

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({
  menuItems,
  isOpen,
  onToggle,
  className,
  buttonAriaLabel = 'Toggle menu',
  menuAriaLabel = 'Navigation menu',
  position,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        onToggle();
      }
    };

    const handleEscapeKey = (event: globalThis.KeyboardEvent) => {
      if (isOpen && event.key === 'Escape') {
        onToggle();
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscapeKey);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscapeKey);
    };
  }, [isOpen, onToggle]);

  useEffect(() => {
    if (isOpen) {
      // Focus the first menu item when menu opens
      firstItemRef.current?.focus();
    }
  }, [isOpen]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return;

    const menuElements = Array.from(menuRef.current?.querySelectorAll('[role="menuitem"]') || []);
    const currentIndex = menuElements.indexOf(document.activeElement as Element);

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (currentIndex < menuElements.length - 1) {
          (menuElements[currentIndex + 1] as HTMLElement).focus();
        } else {
          (menuElements[0] as HTMLElement).focus();
        }
        break;

      case 'ArrowUp':
        event.preventDefault();
        if (currentIndex > 0) {
          (menuElements[currentIndex - 1] as HTMLElement).focus();
        } else {
          (menuElements[menuElements.length - 1] as HTMLElement).focus();
        }
        break;

      case 'Home':
        event.preventDefault();
        (menuElements[0] as HTMLElement).focus();
        break;

      case 'End':
        event.preventDefault();
        (menuElements[menuElements.length - 1] as HTMLElement).focus();
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        if (currentIndex >= 0) {
          const currentItem = menuItems[currentIndex];
          currentItem.onClick();
          onToggle();
          buttonRef.current?.focus();
        }
        break;
    }
  };

  const handleItemClick = (onClick: () => void) => {
    onClick();
    onToggle();
    buttonRef.current?.focus();
  };

  const handleReportBugClick = () => {
    window.open(GITHUB_ISSUES_URL, '_blank', 'noopener,noreferrer');
    onToggle();
    buttonRef.current?.focus();
  };

  return (
    <MenuWrapper className={className}>
      <MenuButton
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-controls="menu-items"
        aria-label={buttonAriaLabel}
        ref={buttonRef}
      >
        ☰
      </MenuButton>

      <MenuBackdrop isOpen={isOpen} onClick={onToggle} />

      <MenuContainer
        isOpen={isOpen}
        position={position}
        ref={menuRef}
        role="menu"
        aria-label={menuAriaLabel}
        id="menu-items"
        onKeyDown={handleKeyDown}
      >
        {menuItems.map((item, index) => (
          <MenuItem
            key={item.key || index}
            onClick={() => handleItemClick(item.onClick)}
            role="menuitem"
            tabIndex={isOpen ? 0 : -1}
            ref={index === 0 ? firstItemRef : null}
            aria-label={item.ariaLabel}
          >
            {item.content} {item.ariaLabel}
          </MenuItem>
        ))}
        <MenuItem
          key="report-bug"
          onClick={handleReportBugClick}
          role="menuitem"
          tabIndex={isOpen ? 0 : -1}
          aria-label="Report Bug"
        >
          🐛 Report Bug
        </MenuItem>
      </MenuContainer>
    </MenuWrapper>
  );
};

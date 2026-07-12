import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

interface DropdownOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface DropdownSelectProps<T extends string> {
  id: string;
  ariaLabel: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
}

/** 单选菜单：复用样式库的居中箭头、圆点状态和键盘交互。 */
export function DropdownSelect<T extends string>({
  id,
  ariaLabel,
  value,
  options,
  onChange,
}: DropdownSelectProps<T>): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];
  const menuId = `${id}-menu`;

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || pendingFocusIndex.current === null) return;
    const index = pendingFocusIndex.current;
    pendingFocusIndex.current = null;
    optionRefs.current[index]?.focus();
  }, [isOpen]);

  const focusOption = (index: number) => {
    if (options.length === 0) return;
    const normalizedIndex = (index + options.length) % options.length;
    if (isOpen) {
      optionRefs.current[normalizedIndex]?.focus();
      return;
    }
    pendingFocusIndex.current = normalizedIndex;
    setIsOpen(true);
  };

  const closeAndFocusTrigger = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(selectedIndex >= 0 ? selectedIndex : 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(options.length - 1);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }
    if (event.key === 'Tab') {
      setIsOpen(false);
      return;
    }

    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = index + 1;
    if (event.key === 'ArrowUp') nextIndex = index - 1;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = options.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    focusOption(nextIndex);
  };

  return (
    <div
      ref={rootRef}
      className={`bingeup-dropdown${isOpen ? ' is-open' : ''}`}
      onBlur={(event) => {
        const nextFocused = event.relatedTarget;
        if (!(nextFocused instanceof Node) || !event.currentTarget.contains(nextFocused)) {
          setIsOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        id={id}
        className="bingeup-dropdown-trigger"
        type="button"
        aria-label={`${ariaLabel}：${selectedOption?.label ?? value}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
          } else {
            focusOption(selectedIndex >= 0 ? selectedIndex : 0);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="bingeup-dropdown-value">
          <small>当前选择</small>
          <strong>{selectedOption?.label ?? value}</strong>
        </span>
        <span className="bingeup-dropdown-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          id={menuId}
          className="bingeup-dropdown-menu"
          role="menu"
          aria-label={`${ariaLabel}选项`}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              className="bingeup-dropdown-option"
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-label={option.label}
              aria-checked={option.value === value}
              onClick={() => {
                onChange(option.value);
                closeAndFocusTrigger();
              }}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              <span className="bingeup-dropdown-option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              <span className="bingeup-dropdown-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

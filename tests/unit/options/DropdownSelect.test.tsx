import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DropdownSelect } from '@/ui/options/DropdownSelect';

const LEVEL_OPTIONS = [
  { value: 'beginner', label: '初学' },
  { value: 'intermediate', label: '一般' },
  { value: 'advanced', label: '进阶' },
] as const;

function Harness({ onChange = vi.fn() }: { onChange?: (value: string) => void }): JSX.Element {
  const [value, setValue] = useState('intermediate');

  return (
    <DropdownSelect
      id="test-level"
      ariaLabel="学习水平"
      value={value}
      options={LEVEL_OPTIONS}
      onChange={(nextValue) => {
        setValue(nextValue);
        onChange(nextValue);
      }}
    />
  );
}

describe('DropdownSelect', () => {
  it('以单选圆点呈现选项并在选择后更新值、关闭菜单', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const trigger = screen.getByRole('button', { name: '学习水平：一般' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    const selected = screen.getByRole('menuitemradio', { name: '一般' });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    expect(selected).toHaveFocus();
    expect(selected).toHaveAttribute('tabindex', '-1');
    expect(document.querySelectorAll('.bingeup-dropdown-radio')).toHaveLength(3);
    expect(document.querySelector('.bingeup-dropdown-check')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: '进阶' }));

    expect(onChange).toHaveBeenCalledWith('advanced');
    expect(screen.getByRole('button', { name: '学习水平：进阶' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('支持方向键浏览选项并用 Escape 返回触发按钮', () => {
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '学习水平：一般' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });

    const selected = screen.getByRole('menuitemradio', { name: '一般' });
    expect(selected).toHaveFocus();

    fireEvent.keyDown(selected, { key: 'ArrowDown' });
    const advanced = screen.getByRole('menuitemradio', { name: '进阶' });
    expect(advanced).toHaveFocus();

    fireEvent.keyDown(advanced, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Tab 离开组合控件时关闭菜单', () => {
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: '学习水平：一般' });
    fireEvent.click(trigger);
    const selected = screen.getByRole('menuitemradio', { name: '一般' });

    fireEvent.keyDown(selected, { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('未知受控值按原值展示，不冒充第一个选项', () => {
    render(
      <DropdownSelect
        id="unknown-deck"
        ariaLabel="当前词库"
        value="deck-missing"
        options={[{ value: 'deck-default', label: '默认词库' }]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '当前词库：deck-missing' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '当前词库：deck-missing' }));
    expect(screen.getByRole('menuitemradio', { name: '默认词库' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

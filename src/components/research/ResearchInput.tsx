// src/components/research/ResearchInput.tsx
//
// Controlled company-name input used by ResearchPanel.
// Submits the trimmed value to the parent on form submit. While the
// pipeline is running the form is disabled and the submit button
// shows a "调研中..." label so users can't fire duplicate requests.

import { useState } from 'react';
import { Search } from 'lucide-react';

interface Props {
  onSubmit: (name: string) => void;
  disabled: boolean;
  initialValue?: string;
}

export function ResearchInput({ onSubmit, disabled, initialValue = '' }: Props) {
  const [value, setValue] = useState(initialValue);
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !disabled;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) onSubmit(trimmed);
      }}
      className="flex gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="输入公司名称（英文或中文）"
        maxLength={100}
        className="flex-1 min-w-0 bg-bg-input border border-border-subtle rounded-lg px-3 py-2.5
                   text-sm text-text-primary placeholder:text-text-tertiary
                   outline-none transition-colors focus:border-accent-primary focus:ring-0 focus-visible:!outline-none
                   disabled:opacity-50"
        aria-label="公司名称"
      />
      <button
        type="submit"
        disabled={!canSubmit}
        className="px-4 py-2.5 rounded-lg border border-transparent bg-button-primary-bg text-white text-sm font-medium
                   enabled:hover:bg-button-primary-hover transition-colors
                   disabled:bg-button-primary-disabled-bg disabled:border-button-primary-disabled-border
                   disabled:text-button-primary-disabled-text disabled:opacity-100
                   disabled:cursor-not-allowed inline-flex items-center gap-2 shrink-0"
      >
        <Search className="w-4 h-4" />
        {disabled ? '调研中...' : '立即调研'}
      </button>
    </form>
  );
}

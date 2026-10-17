import type { ReactNode } from 'react';
import React, { useState, useRef, useEffect, useCallback } from 'react';

interface EditableTextBlockProps {
    initialValue: string;
    onSave: (value: string) => void | boolean | Promise<void | boolean>;
    onDraftChange?: (value: string) => void;
    onFlush?: () => Promise<boolean>;
    renderValue?: (value: string) => ReactNode;
    ariaLabel?: string;
    tagName?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    onEnter?: () => void;
    autoFocus?: boolean;
}

const EditableTextBlock: React.FC<EditableTextBlockProps> = ({
    initialValue,
    onSave, onDraftChange, onFlush, renderValue, ariaLabel,
    tagName = 'div',
    className = '',
    placeholder = 'Type here...',
    multiline = true,
    onEnter,
    autoFocus = false
}) => {
    const [isEditing, setIsEditing] = useState(autoFocus); // Start editing if autoFocus is true
    const [localValue, setLocalValue] = useState(initialValue);
    const contentRef = useRef<HTMLElement>(null);
    const composingRef = useRef(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Sync external changes if not editing
    useEffect(() => {
        if (!isEditing) {
            setLocalValue(initialValue);
        }
    }, [initialValue, isEditing]);

    const handleSave = useCallback(async (newValue: string) => {
        const trimmed = newValue.trim();
        try {
            return trimmed === initialValue || await onSave(trimmed) !== false;
        } catch { return false; }
    }, [initialValue, onSave]);

    const handleChange = useCallback(() => {
        if (!contentRef.current) return;
        const newValue = contentRef.current.innerText;
        setLocalValue(newValue);

        if (onDraftChange) { onDraftChange(newValue); return; }
        // Legacy callers retain the existing debounce.
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            void handleSave(newValue);
        }, 600); // 600ms debounce
    }, [handleSave, onDraftChange]);

    const handleBlur = useCallback(async () => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }
        if (contentRef.current) {
            const value = contentRef.current.innerText;
            if (onDraftChange) onDraftChange(value);
            const ok = onFlush ? await onFlush() : await handleSave(value);
            if (ok === false) return;
        }
        if (renderValue && contentRef.current) contentRef.current.textContent = '';
        setIsEditing(false);
    }, [handleSave, onDraftChange, onFlush, renderValue]);

    const lastEnterTime = useRef<number>(0);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing || composingRef.current || e.keyCode === 229) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            // Revert
            setIsEditing(false);
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
            if (contentRef.current) {
                contentRef.current.innerText = renderValue ? '' : initialValue;
            }
            setLocalValue(initialValue);
        } else if (e.key === 'Enter') {
            if (!multiline) {
                e.preventDefault();
                contentRef.current?.blur();
            } else if (onEnter) {
                // Double-Enter detection (500ms threshold)
                const now = Date.now();
                if (now - lastEnterTime.current < 500) {
                    // Double-Enter detected!
                    e.preventDefault();
                    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
                    if (contentRef.current && !onDraftChange) void handleSave(contentRef.current.innerText);
                    onEnter();
                    lastEnterTime.current = 0; // Reset
                } else {
                    // First Enter: Allow default (newline)
                    // But track time
                    lastEnterTime.current = now;
                    // Standard newline behavior allows contentEditable to insert <div> or <br>
                    // We don't preventDefault here.
                }
            }
        }
    };

    const handleClick = () => {
        setIsEditing(true);
    };

    // Focus management
    useEffect(() => {
        if (isEditing && contentRef.current) {
            contentRef.current.innerText = initialValue;
            contentRef.current.focus();
            // If autoFocus was relevant (newly created), we might want cursor at start or end?
            // Standard behavior usually end, but for new empty item it doesn't matter.
        }
    }, [isEditing]);

    useEffect(() => () => { if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current); }, []);
    const Tag = tagName as any;

    return (
        <Tag
            ref={contentRef}
            aria-label={ariaLabel}
            role={isEditing ? 'textbox' : undefined}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; handleChange(); }}
            contentEditable={isEditing}
            suppressContentEditableWarning={true}
            onClick={handleClick}
            onBlur={handleBlur}
            onInput={handleChange}
            onKeyDown={handleKeyDown}
            className={`
                outline-none min-w-[10px] cursor-text transition-colors duration-200
                bg-transparent
                ${!localValue && placeholder ? 'empty:before:content-[attr(data-placeholder)] empty:before:text-text-tertiary' : ''}
                ${className}
            `}
            data-placeholder={placeholder}
            spellCheck={false} // Clean look
        >
            {isEditing ? undefined : renderValue ? renderValue(initialValue) : initialValue}
        </Tag>
    );
};

export default EditableTextBlock;

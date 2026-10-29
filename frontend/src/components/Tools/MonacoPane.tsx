import { useRef, useEffect } from 'react';
import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

// NOTE: assigning `window.MonacoEnvironment = ...` directly crashes tsc 5.8
// (expando + monaco.d.ts → stack overflow). Object.assign avoids it.
Object.assign(window, {
  MonacoEnvironment: { getWorker: () => new EditorWorker() } satisfies monaco.Environment,
});

interface MonacoPaneProps {
  value: string;
  language: string;
  onChange: (v: string) => void;
  onCursor: (line: number, col: number) => void;
}

/** Full VS Code editor surface — heavy (~4MB chunk); loaded lazily by
 * TextEditor only when "vscode" mode is selected. */
export default function MonacoPane({ value, language, onChange, onCursor }: MonacoPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursor);
  onChangeRef.current = onChange;
  onCursorRef.current = onCursor;

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value,
      language,
      theme: 'vs-dark',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 4,
      insertSpaces: true,
      wordWrap: 'off',
      placeholder: 'Text Editor — start typing...',
      padding: { top: 8 },
    });
    editorRef.current = editor;
    const subContent = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });
    const subCursor = editor.onDidChangeCursorPosition((e) => {
      onCursorRef.current(e.position.lineNumber, e.position.column);
    });
    return () => {
      subContent.dispose();
      subCursor.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (file open, remote load) — skip setValue when the
  // model already matches to avoid a cursor jump on every keystroke.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model && model.getValue() !== value) editor.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) monaco.editor.setModelLanguage(model, language);
  }, [language]);

  return <div ref={containerRef} className="flex-1 min-h-0" />;
}

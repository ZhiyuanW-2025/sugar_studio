export function insertTextareaNewline(
  textarea: HTMLTextAreaElement,
  value: string,
  onChange: (nextValue: string) => void,
) {
  const selectionStart = textarea.selectionStart ?? value.length;
  const selectionEnd = textarea.selectionEnd ?? selectionStart;
  const nextValue = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
  const nextCursor = selectionStart + 1;

  onChange(nextValue);
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(nextCursor, nextCursor);
  });
}

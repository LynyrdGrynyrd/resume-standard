import ranges from './font-coverage.json' with { type: 'json' };

export function unsupportedCharacters(text) {
  return [...new Set([...text].filter(character => {
    if ('\n\r\t'.includes(character)) return false;
    const code = character.codePointAt(0);
    return !ranges.some(([start, end]) => code >= start && code <= end);
  }))];
}

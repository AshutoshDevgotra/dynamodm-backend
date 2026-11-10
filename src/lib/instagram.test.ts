import { formatTemplateText, sanitizeIGButtons } from './instagram';

describe('formatTemplateText', () => {
  it('strips newlines and normalizes whitespace in message title and subtitle', () => {
    const raw = "Hey! Thanks for commenting 🙌\n\nHere's the free resource you asked for 👇\n\nLet me know if you have any questions!";
    const result = formatTemplateText(raw);

    expect(result.title).not.toMatch(/[\r\n]/);
    if (result.subtitle) {
      expect(result.subtitle).not.toMatch(/[\r\n]/);
    }
    expect(result.title.length).toBeLessThanOrEqual(80);
    if (result.subtitle) {
      expect(result.subtitle.length).toBeLessThanOrEqual(80);
    }
  });

  it('provides a safe default when message is empty or whitespace', () => {
    const result = formatTemplateText('   \n\n   ');
    expect(result.title).toBe('Tap below to open link');
    expect(result.subtitle).toBeUndefined();
  });

  it('keeps short single line message as title without subtitle', () => {
    const result = formatTemplateText('Check out our newest collection!');
    expect(result.title).toBe('Check out our newest collection!');
    expect(result.subtitle).toBeUndefined();
  });
});

describe('sanitizeIGButtons', () => {
  it('normalizes buttons and removes newlines from button titles', () => {
    const buttons = [
      { title: '  Get\nResource  ', url: 'example.com/guide' },
      { title: 'A very long title that exceeds twenty characters', url: 'https://example.com/long' },
    ];
    const clean = sanitizeIGButtons(buttons);
    expect(clean).toBeDefined();
    expect(clean).toHaveLength(2);
    expect(clean![0].title).toBe('Get Resource');
    expect(clean![0].url).toBe('https://example.com/guide');
    expect(clean![1].title.length).toBeLessThanOrEqual(20);
  });

  it('handles postback buttons', () => {
    const buttons = [
      { type: 'postback' as const, title: 'Already followed', payload: 'FOLLOW_CHECK:123' },
    ];
    const clean = sanitizeIGButtons(buttons);
    expect(clean).toBeDefined();
    expect(clean![0].type).toBe('postback');
    expect(clean![0].title).toBe('Already followed');
  });

  it('limits buttons to at most 3', () => {
    const buttons = [
      { title: 'B1', url: 'https://1.com' },
      { title: 'B2', url: 'https://2.com' },
      { title: 'B3', url: 'https://3.com' },
      { title: 'B4', url: 'https://4.com' },
    ];
    const clean = sanitizeIGButtons(buttons);
    expect(clean).toHaveLength(3);
  });
});

import { extractStoryReplyId, matchesKeyword } from './ruleEngine';

describe('extractStoryReplyId', () => {
  it('supports the reply_to story payload used by Instagram messaging webhooks', () => {
    expect(extractStoryReplyId({ mid: 'mid-123', reply_to: { story: { id: 'story-123' } } })).toBe('story-123');
  });

  it('supports story reply attachment payloads', () => {
    expect(extractStoryReplyId({ mid: 'mid-456', attachments: [{ type: 'story_reply', payload: { url: 'story-url' } }] })).toBe('story-url');
  });
});

describe('matchesKeyword', () => {
  it('matches case-insensitively with surrounding punctuation and whitespace', () => {
    expect(matchesKeyword('  ✨ FREE\u00A0GUIDE!!!  ', ['free guide'])).toBe(true);
  });

  it('matches comma-separated keywords supplied as one legacy value', () => {
    expect(matchesKeyword('Send me the guide', ['SIP, GUIDE'])).toBe(true);
  });

  it('ignores zero-width characters in comments', () => {
    expect(matchesKeyword('I want the G\u200Buide', ['guide'])).toBe(true);
  });

  it('does not match an unrelated keyword', () => {
    expect(matchesKeyword('I want the checklist', ['guide'])).toBe(false);
  });
});

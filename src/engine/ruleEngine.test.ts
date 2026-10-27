import { matchesKeyword } from './ruleEngine';

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

/**
 * Generate comment reply variations to avoid bot detection.
 * Returns 5 slightly different variations of the same message to make replies look more natural.
 */
export function generateCommentReplyVariations(originalMessage: string): string[] {
  const variations: string[] = [];
  
  // Variation 1: Original (baseline)
  variations.push(originalMessage);
  
  // Variation 2: Add subtle greeting prefix
  const greetings = ['Hey! ', 'Hi! ', 'Hello! ', ''];
  variations.push(`${greetings[Math.floor(Math.random() * greetings.length)]}${originalMessage}`);
  
  // Variation 3: Add casual suffix
  const suffixes = [' 😊', ' 🙌', ' ✨', ''];
  variations.push(`${originalMessage}${suffixes[Math.floor(Math.random() * suffixes.length)]}`);
  
  // Variation 4: Add spacing variation (double space after punctuation occasionally)
  let spacedMessage = originalMessage;
  if (originalMessage.includes('. ')) {
    spacedMessage = originalMessage.replace(/\. /g, (match, offset) => 
      Math.random() > 0.5 ? '.  ' : match
    );
  }
  variations.push(spacedMessage);
  
  // Variation 5: Combine greeting + emoji
  const randomGreeting = greetings[Math.floor(Math.random() * greetings.length)];
  const randomSuffix = suffixes[Math.floor(Math.random() * suffixes.length)];
  variations.push(`${randomGreeting}${originalMessage}${randomSuffix}`.trim());
  
  // Remove duplicates and return only unique variations
  return [...new Set(variations)].slice(0, 5);
}

/**
 * Select a random variation from the list to avoid repetitive bot-like responses
 */
export function getRandomMessageVariation(message: string): string {
  const variations = generateCommentReplyVariations(message);
  return variations[Math.floor(Math.random() * variations.length)];
}

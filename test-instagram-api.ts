import axios from 'axios';
import { sendDM, getProfile } from './src/lib/instagram';

const TEST_CONFIG = {
  IG_USER_ID: process.env.TEST_IG_USER_ID || '17841456534142359',
  IG_ACCESS_TOKEN: process.env.TEST_IG_ACCESS_TOKEN || '',
  RECIPIENT_ID: process.env.TEST_RECIPIENT_ID || '17841456534142359',
};

if (!TEST_CONFIG.IG_ACCESS_TOKEN) {
  console.error('❌ TEST_IG_ACCESS_TOKEN environment variable is required');
  process.exit(1);
}

async function runTests() {
  console.log('🚀 Starting Instagram API tests...\n');

  try {
    console.log('1️⃣  Testing getProfile()');
    const profile = await getProfile(TEST_CONFIG.IG_USER_ID, TEST_CONFIG.IG_ACCESS_TOKEN);
    console.log('✅ Profile fetched:', {
      username: profile.username,
      followers: profile.followers_count,
      biography: profile.biography,
    });
    console.log('');

    console.log('2️⃣  Testing sendDM() - Sending message to self');
    const dmResult = await sendDM(
      TEST_CONFIG.IG_USER_ID,
      TEST_CONFIG.RECIPIENT_ID,
      `🚀 Test message from DynamoDM at ${new Date().toISOString()}`,
      TEST_CONFIG.IG_ACCESS_TOKEN
    );
    console.log('✅ DM sent:', dmResult);
    console.log('');

    console.log('3️⃣  Testing webhook verification manually');
    console.log('To verify webhook manually:');
    console.log(`  curl -X GET "http://localhost:3001/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${process.env.WEBHOOK_VERIFY_TOKEN}&hub.challenge=test_challenge_string"`);
    console.log('');

    console.log('✅ All tests passed!');
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

runTests();

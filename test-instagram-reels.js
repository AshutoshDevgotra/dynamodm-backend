const axios = require('axios');

// Test Instagram Media API to see if reels are being returned
const TEST_IG_USER_ID = '17841456534142359';
const TEST_IG_ACCESS_TOKEN = 'IGAAPCoAOMkIZABZAGJ4aF9XS2kzcWtDNzJ0S2lVN2FhUFhSZAmgzRlg5MVVOamNzZADNyeExVZAGMzcTZADNmhPZAkE5UXU4cjFZARVdtOFpTdkNJSkMxZAzJ1a1JWaW9WYklOZADk5MEd2VS11dDVyT0lmRmh6UkI1WDIxWW9jNWZAmejRkSQZDZD';

async function testInstagramReels() {
  try {
    console.log('🔍 Testing Instagram Media API...\n');
    console.log('Account:', TEST_IG_USER_ID);
    console.log('');

    const response = await axios.get(
      `https://graph.instagram.com/v23.0/${TEST_IG_USER_ID}/media`,
      {
        params: {
          fields: 'id,caption,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,media_type,media_product_type',
          limit: 30,
          access_token: TEST_IG_ACCESS_TOKEN,
        },
      }
    );

    const media = response.data.data;
    console.log(`✅ Fetched ${media.length} media items\n`);

    // Group by media_product_type
    const grouped = {};
    media.forEach((item) => {
      const type = item.media_product_type || 'UNKNOWN';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push({
        id: item.id,
        media_type: item.media_type,
        caption: (item.caption || '').substring(0, 50) + '...',
        timestamp: item.timestamp,
      });
    });

    console.log('📊 Media breakdown:\n');
    Object.keys(grouped).forEach((type) => {
      console.log(`${type}: ${grouped[type].length} items`);
      grouped[type].slice(0, 3).forEach((item) => {
        console.log(`  - ID: ${item.id}`);
        console.log(`    Type: ${item.media_type}`);
        console.log(`    Caption: ${item.caption}`);
        console.log(`    Posted: ${item.timestamp}`);
        console.log('');
      });
    });

    // Check specifically for REELS
    const reels = media.filter((m) => m.media_product_type === 'REELS');
    const feed = media.filter((m) => m.media_product_type === 'FEED');

    console.log('\n📈 Summary:');
    console.log(`Total media: ${media.length}`);
    console.log(`Feed posts: ${feed.length}`);
    console.log(`Reels: ${reels.length}`);
    console.log(`Other: ${media.length - feed.length - reels.length}`);

    if (reels.length === 0) {
      console.log('\n⚠️  NO REELS FOUND!');
      console.log('\nPossible reasons:');
      console.log('1. Instagram account was NOT a Professional account when reels were posted');
      console.log('2. No reels have been posted yet');
      console.log('3. Reels were posted on a Personal account (not Business/Creator)');
      console.log('4. Access token does not have proper permissions');
      console.log('\nRecommendation:');
      console.log('- Verify account is Business or Creator (not Personal)');
      console.log('- Post a NEW reel while account is Professional');
      console.log('- Wait 5 minutes and run this script again');
    } else {
      console.log('\n✅ REELS ARE BEING RETURNED BY INSTAGRAM API');
      console.log('\nIf reels are not showing in the frontend:');
      console.log('- Check frontend deployment is latest');
      console.log('- Clear browser cache');
      console.log('- Check browser console for errors');
    }

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testInstagramReels();

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');

function decryptToken(encrypted) {
  const [ivHex, authTagHex, data] = encrypted.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function testHouseOfOrangeMedia() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const CreatorAccount = mongoose.model('CreatorAccount', new mongoose.Schema({}, { strict: false, collection: 'creatoraccounts' }));

    // Find @houseoforange.in account
    const account = await CreatorAccount.findOne({ 
      igUsername: { $regex: /houseoforange/i },
      isConnected: true 
    }).select('+igAccessToken');

    if (!account || !account.igAccessToken) {
      console.log('❌ @houseoforange.in account not found or has no access token');
      process.exit(1);
    }

    console.log('🎯 Testing @houseoforange.in Instagram account');
    console.log(`IG User ID: ${account.igUserId}\n`);

    // Decrypt access token
    const accessToken = decryptToken(account.igAccessToken);

    // Fetch media from Instagram API
    const response = await axios.get(
      `https://graph.instagram.com/v23.0/${account.igUserId}/media`,
      {
        params: {
          fields: 'id,caption,media_url,thumbnail_url,permalink,like_count,comments_count,timestamp,media_type,media_product_type',
          limit: 50,
          access_token: accessToken,
        },
      }
    );

    const media = response.data.data;
    console.log(`✅ Fetched ${media.length} media items from Instagram API\n`);

    // Group by media_product_type
    const grouped = {};
    media.forEach((item) => {
      const type = item.media_product_type || 'UNKNOWN';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(item);
    });

    console.log('📊 Media breakdown:\n');
    Object.keys(grouped).forEach((type) => {
      console.log(`${type}: ${grouped[type].length} items`);
      console.log('─'.repeat(60));
      grouped[type].slice(0, 5).forEach((item, idx) => {
        console.log(`${idx + 1}. ID: ${item.id}`);
        console.log(`   Media Type: ${item.media_type}`);
        console.log(`   Caption: ${(item.caption || 'No caption').substring(0, 60)}...`);
        console.log(`   Posted: ${new Date(item.timestamp).toLocaleString()}`);
        console.log(`   Permalink: ${item.permalink}`);
        console.log('');
      });
    });

    // Summary
    const reels = media.filter((m) => m.media_product_type === 'REELS');
    const feed = media.filter((m) => m.media_product_type === 'FEED');
    const stories = media.filter((m) => m.media_product_type === 'STORY');

    console.log('\n📈 Summary:');
    console.log(`Total media: ${media.length}`);
    console.log(`Feed posts: ${feed.length}`);
    console.log(`Reels: ${reels.length}`);
    console.log(`Stories: ${stories.length}`);
    console.log(`Other: ${media.length - feed.length - reels.length - stories.length}`);

    if (reels.length === 0) {
      console.log('\n⚠️  NO REELS FOUND FOR @houseoforange.in!');
      console.log('\n🔍 Possible reasons:');
      console.log('1. ❌ No reels have been posted to this account yet');
      console.log('2. ❌ Account was PERSONAL when reels were posted (Instagram API limitation)');
      console.log('3. ❌ Reels were deleted');
      console.log('4. ❌ Account permissions issue');
      console.log('\n💡 Solution:');
      console.log('→ Go to Instagram app');
      console.log('→ Verify @houseoforange.in is a Business/Creator account (Settings → Account)');
      console.log('→ Post a NEW reel while account is Professional');
      console.log('→ Wait 5-10 minutes');
      console.log('→ Run this test again');
    } else {
      console.log('\n✅ REELS ARE AVAILABLE!');
      console.log(`\nFound ${reels.length} reel(s) - they should appear in the OrangeFlow UI.`);
      console.log('\nIf reels are not showing in frontend:');
      console.log('1. Clear browser cache (Ctrl + Shift + R)');
      console.log('2. Check browser console for errors');
      console.log('3. Verify Vercel deployment is latest');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    process.exit(1);
  }
}

testHouseOfOrangeMedia();

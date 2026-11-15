require('dotenv').config();
const mongoose = require('mongoose');

async function checkConnectedAccounts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const CreatorAccount = mongoose.model('CreatorAccount', new mongoose.Schema({}, { strict: false, collection: 'creatoraccounts' }));
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false, collection: 'users' }));

    // Find all connected accounts
    const accounts = await CreatorAccount.find({ isConnected: true }).select('userId igUserId igUsername name isConnected');
    
    console.log(`📊 Found ${accounts.length} connected Instagram accounts:\n`);

    for (const account of accounts) {
      const user = await User.findById(account.userId).select('email name');
      console.log('─'.repeat(60));
      console.log(`Instagram: @${account.igUsername || 'unknown'}`);
      console.log(`Name: ${account.name || 'N/A'}`);
      console.log(`IG User ID: ${account.igUserId}`);
      console.log(`User Email: ${user?.email || 'N/A'}`);
      console.log(`User ID: ${account.userId}`);
      console.log('');
    }

    // Find @houseoforange.in specifically
    const houseOfOrange = await CreatorAccount.findOne({ 
      igUsername: { $regex: /houseoforange/i },
      isConnected: true 
    }).select('+igAccessToken');

    if (houseOfOrange) {
      console.log('\n🎯 Found @houseoforange.in account:');
      console.log('─'.repeat(60));
      console.log(`Username: @${houseOfOrange.igUsername}`);
      console.log(`IG User ID: ${houseOfOrange.igUserId}`);
      console.log(`Has Access Token: ${houseOfOrange.igAccessToken ? 'Yes' : 'No'}`);
      console.log(`Connected: ${houseOfOrange.isConnected}`);
      
      if (houseOfOrange.igAccessToken) {
        console.log('\n✅ You can test this account\'s media with:');
        console.log(`   IG_USER_ID="${houseOfOrange.igUserId}"`);
      }
    } else {
      console.log('\n⚠️  @houseoforange.in account not found or not connected');
      console.log('Please connect the account first through OrangeFlow platform');
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkConnectedAccounts();

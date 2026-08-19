const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

const ALGO = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Creator = mongoose.model('CreatorAccount', new mongoose.Schema({
    userId: String,
    instagramBusinessId: String,
    accessToken: { type: String, select: false }
  }, { collection: 'creatoraccounts' }));

  const creator = await Creator.findOne().select('+accessToken');
  if (!creator) return console.log('No creator found');

  const textParts = creator.accessToken.split(':');
  const ivFromDb = Buffer.from(textParts.shift(), 'hex');
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
  const authTag = encryptedText.slice(encryptedText.length - 16);
  const decipher = crypto.createDecipheriv(ALGO, KEY, ivFromDb);
  decipher.setAuthTag(authTag);
  let token = decipher.update(encryptedText.slice(0, encryptedText.length - 16), 'hex', 'utf8');
  token += decipher.final('utf8');

  console.log('Token decrypted, making API call to Instagram Basic...');
  try {
    const res = await axios.get(`https://graph.facebook.com/v20.0/${creator.instagramBusinessId}?fields=username`, {
      params: { access_token: token }
    });
    console.log('✅ API Call Success! Facebook has registered the call:', res.data);
  } catch(e) {
    console.error('❌ API Call Failed:', e.response?.data || e.message);
  }
  process.exit(0);
}

run();

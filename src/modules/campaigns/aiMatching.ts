import { Router, Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authenticate, requireRole } from '../../middleware/auth';
import { CreatorAccount } from '../../models/CreatorAccount';

const router = Router();
router.use(authenticate, requireRole('brand'));

// POST /api/discovery/ai-match
// Uses Gemini to process a natural language search, converts to vector, and searches Atlas
router.post('/ai-match', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query } = req.body;
    if (!query) {
      res.status(400).json({ success: false, message: 'Search query is required' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ success: false, message: 'Gemini API Key is not configured' });
      return;
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // 1. Generate Query Embedding
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await embeddingModel.embedContent(query);
    const queryVector = result.embedding.values;

    // 2. MongoDB Atlas Vector Search
    // Requires an Atlas Search index named 'vector_index' on the 'embedding' field
    const pipeline = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: queryVector,
          numCandidates: 50,
          limit: 10
        }
      },
      {
        $match: { isConnected: true }
      },
      {
        $project: {
          _id: 1,
          name: 1,
          username: 1,
          followersCount: 1,
          profile: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    const creators = await CreatorAccount.aggregate(pipeline);

    if (creators.length === 0) {
      res.json({ success: true, data: { creators: [], recommendation: 'No creators matched your criteria.' } });
      return;
    }

    // 3. Gemini RAG - Generate reasoning based on retrieved profiles
    const generativeModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const contextStr = creators.map((c, i) => `
    Creator ${i + 1}:
    Name: ${c.name} (@${c.username})
    Followers: ${c.followersCount}
    Niche: ${c.profile?.niche || 'Unknown'}
    Top Audience Age: ${c.profile?.audienceDemographics?.topAgeRanges?.[0]?.age || 'Unknown'}
    Top Audience Gender: ${c.profile?.audienceDemographics?.topGenders?.[0]?.gender || 'Unknown'}
    `).join('\n');

    const prompt = `You are an AI Matchmaker for brands looking for Instagram creators.
The brand's request is: "${query}"

Based on the database search, here are the top matching creators:
${contextStr}

Write a concise, 2-paragraph recommendation to the brand summarizing why these creators are a good fit for their campaign. Do not invent any creators, only use the ones provided.`;

    const chatResult = await generativeModel.generateContent(prompt);
    const recommendation = chatResult.response.text();

    res.json({
      success: true,
      data: {
        recommendation,
        creators
      }
    });

  } catch (error: any) {
    console.error('AI Matching Error:', error);
    res.status(500).json({ success: false, message: 'Failed to perform AI matching' });
  }
});

export default router;

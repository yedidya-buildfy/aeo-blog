import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testDatabase() {
  try {
    console.log('Testing database connection...');

    // Check existing keyword analyses
    const keywordCount = await prisma.keywordAnalysis.count();
    console.log(`Found ${keywordCount} keyword analyses in database`);

    // Get the most recent keyword analysis
    const latestKeywords = await prisma.keywordAnalysis.findFirst({
      orderBy: { updatedAt: 'desc' }
    });

    if (latestKeywords) {
      console.log('\nLatest keyword analysis:');
      console.log('- Shop Domain:', latestKeywords.shopDomain);
      console.log('- Store URL:', latestKeywords.storeUrl);
      console.log('- Main Products:', latestKeywords.mainProducts);
      console.log('- Problems Solved:', latestKeywords.problemsSolved);
      console.log('- Customer Searches:', latestKeywords.customerSearches);
      console.log('- Created At:', latestKeywords.createdAt);
      console.log('- Updated At:', latestKeywords.updatedAt);
    } else {
      console.log('No keyword analyses found');
    }

    // Check blog posts
    const blogPostCount = await prisma.blogPost.count();
    console.log(`\nFound ${blogPostCount} blog posts in database`);

    // Check sessions (to understand auth status)
    const sessionCount = await prisma.session.count();
    console.log(`Found ${sessionCount} sessions in database`);

    console.log('\nDatabase test completed successfully');

  } catch (error) {
    console.error('Database test failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testDatabase();
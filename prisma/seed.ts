// Seed script for initial database data
// Run with: npx prisma db seed

// Load environment before importing Prisma
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Prisma 7 requires adapter
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding database...');
    console.log(`DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 40)}...`);

    // Create default admin user (will be updated on first login)
    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@altermundi.net' },
        update: {},
        create: {
            zitadelId: 'placeholder-admin',
            email: 'admin@altermundi.net',
            name: 'Admin',
            role: 'ADMIN',
            isVerified: true,
        },
    });
    console.log(`✓ Admin user: ${adminUser.email}`);

    // Create tags
    const tagData = [
        // Languages
        { name: 'Spanish', slug: 'spanish', category: 'LANGUAGE' as const, sortOrder: 1 },
        { name: 'English', slug: 'english', category: 'LANGUAGE' as const, sortOrder: 2 },

        // Moods
        { name: 'Calm', slug: 'calm', category: 'MOOD' as const, sortOrder: 1 },
        { name: 'Sleep', slug: 'sleep', category: 'MOOD' as const, sortOrder: 2 },
        { name: 'Focus', slug: 'focus', category: 'MOOD' as const, sortOrder: 3 },
        { name: 'Energizing', slug: 'energizing', category: 'MOOD' as const, sortOrder: 4 },
        { name: 'Love', slug: 'love', category: 'MOOD' as const, sortOrder: 5 },

        // Techniques
        { name: 'Breathwork', slug: 'breathwork', category: 'TECHNIQUE' as const, sortOrder: 1 },
        { name: 'Body Scan', slug: 'body-scan', category: 'TECHNIQUE' as const, sortOrder: 2 },
        { name: 'Visualization', slug: 'visualization', category: 'TECHNIQUE' as const, sortOrder: 3 },
        { name: 'Guided', slug: 'guided', category: 'TECHNIQUE' as const, sortOrder: 4 },

        // Durations
        { name: 'Quick (< 5 min)', slug: 'quick', category: 'DURATION' as const, sortOrder: 1 },
        { name: 'Medium (5-15 min)', slug: 'medium', category: 'DURATION' as const, sortOrder: 2 },
        { name: 'Long (> 15 min)', slug: 'long', category: 'DURATION' as const, sortOrder: 3 },
    ];

    for (const tag of tagData) {
        await prisma.tag.upsert({
            where: { slug: tag.slug },
            update: {},
            create: tag,
        });
    }
    console.log(`✓ Created ${tagData.length} tags`);

    // Meditations are uploaded by providers via the app — no hardcoded entries

    console.log('🌱 Seeding complete!');
}

main()
    .catch((e) => {
        console.error('Seed error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });

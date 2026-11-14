// Checks that MONGODB_URI in .env can connect, and lists what's in the cluster.
// Run with: npm run db:test
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Is it in .env?');
  process.exit(1);
}
if (uri.includes('<') || uri.includes('>')) {
  console.error('MONGODB_URI still contains a <placeholder>. Paste the real value.');
  process.exit(1);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

try {
  await client.connect();
  await client.db('admin').command({ ping: 1 });
  console.log('✅ Connected to MongoDB');

  const { databases } = await client.db().admin().listDatabases();
  for (const { name } of databases) {
    if (['admin', 'local', 'config'].includes(name)) continue;
    const cols = await client.db(name).listCollections().toArray();
    console.log(`  ${name}: ${cols.length ? '' : '(no collections)'}`);
    for (const col of cols) {
      const n = await client.db(name).collection(col.name).estimatedDocumentCount();
      console.log(`    - ${col.name} (${n} docs)`);
    }
  }
} catch (e) {
  console.error('❌ Connection failed:', e.message.replace(/\/\/[^@]+@/, '//***@'));
  if (/auth/i.test(e.message)) {
    console.error('   → Username/password rejected. Check the database user in Atlas → Database Access.');
  } else if (/timed out|ENOTFOUND|querySrv/i.test(e.message)) {
    console.error('   → Could not reach the cluster. Check the host name and Atlas → Network Access (add your IP).');
  }
  process.exitCode = 1;
} finally {
  await client.close();
}

import path from 'node:path';
import fs from 'node:fs';
import { defineConfig } from 'prisma/config';

for (const envPath of [path.join(__dirname, '.env'), path.join(__dirname, '../../.env')]) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
      if (match) process.env[match[1]] ??= match[2];
    }
    break;
  }
}

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL!,
  },
  migrations: {
    seed: 'tsx ./prisma/seed.ts',
  },
});

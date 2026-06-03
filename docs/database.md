# Database

This app uses Prisma with SQLite by default:

```env
DATABASE_URL="file:./dev.db"
```

SQLite keeps the local trading cockpit simple for a single-user machine. Do not store Robinhood account numbers, OAuth tokens, or market-data API keys in the database. Keep secrets in `.env`.

## Switch To MySQL Later

1. Provision a MySQL database.
2. Change `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL")
}
```

3. Set `.env`:

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DATABASE"
```

4. Run:

```bash
npm run db:generate
npm run db:migrate -- --name mysql_init
npm run db:seed
```

Review Decimal precision before moving real trading history to MySQL or Postgres.

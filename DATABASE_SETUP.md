# Database Setup

This application supports both local PostgreSQL and Neon cloud databases.

## Option 1: Local PostgreSQL (Recommended for Development)

1. Install PostgreSQL on your system
2. Create a database:
   ```bash
   psql -U your_username
   CREATE DATABASE gansytems;
   \q
   ```

3. Update `.env`:
   ```env
   DATABASE_URL=postgresql://your_username@localhost:5432/gansytems
   ```

4. Run migrations:
   ```bash
   npm run migrate
   ```

## Option 2: Neon Cloud (Recommended for Production)

1. Create a Neon account at https://neon.tech
2. Create a new project and database
3. Copy the connection string from the Neon dashboard
4. Update `.env`:
   ```env
   DATABASE_URL=postgresql://user:pass@ep-xxx.neon.tech/dbname?sslmode=require
   ```

5. Run migrations:
   ```bash
   npm run migrate
   ```

## How It Works

The application automatically detects which database driver to use based on the connection string:

- **Local PostgreSQL**: Uses `postgres` driver (standard PostgreSQL protocol)
- **Neon Cloud**: Uses `@neondatabase/serverless` driver (HTTP-based)

No code changes needed - just update the `DATABASE_URL` environment variable!

## Switching Between Databases

To switch from local to cloud (or vice versa):

1. Update `DATABASE_URL` in `.env`
2. Run `npm run migrate` to apply schema to the new database
3. Restart your dev server

The application will automatically use the correct driver.

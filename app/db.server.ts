import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient | undefined;
}

// Create Prisma client with connection pool settings
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasourceUrl: process.env.DATABASE_URL
  });
}

// Use global variable in development to prevent too many connections
let prisma: PrismaClient;

if (process.env.NODE_ENV === "production") {
  prisma = createPrismaClient();
} else {
  if (!global.prismaGlobal) {
    global.prismaGlobal = createPrismaClient();
  }
  prisma = global.prismaGlobal;
}

// Connect explicitly on startup
if (process.env.NODE_ENV === "development") {
  prisma.$connect().catch((error) => {
    console.error("Failed to connect to database:", error);
  });
}

export default prisma;

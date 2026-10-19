/* eslint-disable */
/** auto generated, do not edit */
import { sql } from 'drizzle-orm';
import { foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar, customType } from "drizzle-orm/pg-core"

export const customTimestamptz = customType<{
  data: Date;
  driverData: string;
  config: { precision?: number };
}>({
  dataType(config) {
    const precision = typeof config?.precision !== 'undefined'
      ? ` (${config.precision})`
      : '';
    return `timestamptz${precision}`;
  },
  toDriver(value: Date | string | number) {
    if (value == null) return value as any;
    if (typeof value === 'number') return new Date(value).toISOString();
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    throw new Error('Invalid timestamp value');
  },
  fromDriver(value: string | Date): Date {
    if (value instanceof Date) return value;
    return new Date(value);
  },
});

export const userProfile = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'user_profile';
  },
  toDriver(value: string) {
    return sql`ROW(${value})::user_profile`;
  },
  fromDriver(value: string) {
    const [userId] = value.slice(1, -1).split(',');
    return userId.trim();
  },
});

export type FileAttachment = {
  bucket_id: string;
  file_path: string;
};

export const fileAttachment = customType<{
  data: FileAttachment;
  driverData: string;
}>({
  dataType() {
    return 'file_attachment';
  },
  toDriver(value: FileAttachment) {
    return sql`ROW(${value.bucket_id},${value.file_path})::file_attachment`;
  },
  fromDriver(value: string): FileAttachment {
    const [bucketId, filePath] = value.slice(1, -1).split(',');
    return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
  },
});

export function escapeLiteral(str: string): string {
  return "'" + str.replace(/'/g, "''") + "'";
}

export const userProfileArray = customType<{
  data: string[];
  driverData: string;
}>({
  dataType() {
    return 'user_profile[]';
  },
  toDriver(value: string[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::user_profile[]`;
    }
    const elements = value.map(id => `ROW(${escapeLiteral(id)})::user_profile`).join(',');
    return sql.raw(`ARRAY[${elements}]::user_profile[]`);
  },
  fromDriver(value: string): string[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => m.slice(1, -1).split(',')[0].trim());
  },
});

export const fileAttachmentArray = customType<{
  data: FileAttachment[];
  driverData: string;
}>({
  dataType() {
    return 'file_attachment[]';
  },
  toDriver(value: FileAttachment[]) {
    if (!value || value.length === 0) {
      return sql`'{}'::file_attachment[]`;
    }
    const elements = value.map(f =>
      `ROW(${escapeLiteral(f.bucket_id)},${escapeLiteral(f.file_path)})::file_attachment`
    ).join(',');
    return sql.raw(`ARRAY[${elements}]::file_attachment[]`);
  },
  fromDriver(value: string): FileAttachment[] {
    if (!value || value === '{}') return [];
    const inner = value.slice(1, -1);
    const matches = inner.match(/\([^)]*\)/g) || [];
    return matches.map(m => {
      const [bucketId, filePath] = m.slice(1, -1).split(',');
      return { bucket_id: bucketId.trim(), file_path: filePath.trim() };
    });
  },
});

export const opType = pgEnum("op_type", ['INSERT', 'UPDATE', 'DELETE']);

export const pgAudit = pgTable("pg_audit", {
  eventId: varchar("event_id", { length: 64 }).primaryKey(),
  eventTime: timestamp("event_time", { mode: 'string' }).notNull(),
  targetTable: varchar("target_table", { length: 255 }).notNull(),
  type: opType("type").notNull(),
  /**
   * 数据变更日志详情
   */
  details: jsonb("details"),
}, (table) => [
  index("idx_pg_audit_table_name").on(table.targetTable, table.eventTime),
  index("idx_pg_audit_table").on(table.targetTable),
]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull(),
  productId: varchar("product_id", { length: 50 }).notNull(),
  title: text("title").notNull(),
  region: varchar("region", { length: 50 }),
  productUrl: text("product_url").notNull(),
  imageUrl: text("image_url"),
  category: varchar("category", { length: 255 }),
  shopName: varchar("shop_name", { length: 255 }),
  shopType: varchar("shop_type", { length: 50 }),
  operationMode: varchar("operation_mode", { length: 50 }),
  shopSales: integer("shop_sales"),
  price: varchar("price", { length: 50 }),
  priceBrl: varchar("price_brl", { length: 50 }),
  firstThreeDaysSales: integer("first_three_days_sales"),
  recentThreeDaysSales: integer("recent_three_days_sales"),
  totalSales: integer("total_sales"),
  firstThreeDaysRevenue: varchar("first_three_days_revenue", { length: 50 }),
  firstThreeDaysRevenueBrl: varchar("first_three_days_revenue_brl", { length: 50 }),
  recentThreeDaysRevenue: varchar("recent_three_days_revenue", { length: 50 }),
  recentThreeDaysRevenueBrl: varchar("recent_three_days_revenue_brl", { length: 50 }),
  totalRevenue: varchar("total_revenue", { length: 50 }),
  totalRevenueBrl: varchar("total_revenue_brl", { length: 50 }),
  influencerCount: integer("influencer_count"),
  decision: varchar("decision", { length: 20 }).notNull().default('untouched'),
  sortIndex: integer("sort_index").notNull().default(0),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
}, (table) => [
  index("idx_products_batch_id").on(table.batchId),
  index("idx_products_batch_decision").on(table.batchId, table.decision),
  index("idx_products_batch_sort").on(table.batchId, table.sortIndex),
  foreignKey({
    columns: [table.batchId],
    foreignColumns: [batches.id],
    name: "products_batch_id_fkey",
  }).onDelete("cascade"),
]);

export const batches = pgTable("batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  totalCount: integer("total_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default('processing'),
  deletedAt: customTimestamptz("deleted_at", { precision: 3 }),
  deletedBy: userProfile("deleted_by"),
  // System field: Creation time (auto-filled, do not modify)
  createdAt: customTimestamptz("_created_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Creator (auto-filled, do not modify)
  createdBy: userProfile("_created_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
  // System field: Update time (auto-filled, do not modify)
  updatedAt: customTimestamptz("_updated_at", { precision: 3 }).notNull().default(sql`CURRENT_TIMESTAMP`),
  // System field: Updater (auto-filled, do not modify)
  updatedBy: userProfile("_updated_by").default(sql`CASE
    WHEN (current_setting('app.user_id'::text, true) = ''::text) THEN NULL`),
});

// table aliases
export const batchesTable = batches;
export const pgAuditTable = pgAudit;
export const productsTable = products;

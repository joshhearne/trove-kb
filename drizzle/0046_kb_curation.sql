CREATE TABLE "kb_article_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"action" text NOT NULL,
	"user_id" uuid,
	"actor_name" text,
	"collection_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text,
	"subcategory" text,
	"body" text,
	"original" jsonb,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_revisions_action_check" CHECK ("kb_article_revisions"."action" IN ('edited','replaced','moved','recategorized','removed','restored'))
);
--> statement-breakpoint
CREATE TABLE "kb_import_exclusions" (
	"collection_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"reason" text NOT NULL,
	"article_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_import_exclusions_collection_id_source_key_pk" PRIMARY KEY("collection_id","source_key"),
	CONSTRAINT "kb_import_exclusions_reason_check" CHECK ("kb_import_exclusions"."reason" IN ('removed','moved','edited'))
);
--> statement-breakpoint
ALTER TABLE "kb_articles" ADD COLUMN "placed_manually" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "kb_article_revisions" ADD CONSTRAINT "kb_article_revisions_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_article_revisions" ADD CONSTRAINT "kb_article_revisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_import_exclusions" ADD CONSTRAINT "kb_import_exclusions_collection_id_kb_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."kb_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_import_exclusions" ADD CONSTRAINT "kb_import_exclusions_article_id_kb_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kb_import_exclusions" ADD CONSTRAINT "kb_import_exclusions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "kb_article_revisions_article_idx" ON "kb_article_revisions" USING btree ("article_id","created_at");
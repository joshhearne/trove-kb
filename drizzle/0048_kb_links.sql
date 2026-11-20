CREATE TABLE "kb_links" (
	"from_kind" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_kind" text NOT NULL,
	"to_id" uuid NOT NULL,
	CONSTRAINT "kb_links_from_kind_from_id_to_kind_to_id_pk" PRIMARY KEY("from_kind","from_id","to_kind","to_id"),
	CONSTRAINT "kb_links_kinds_check" CHECK ("kb_links"."from_kind" IN ('kb','doc') AND "kb_links"."to_kind" IN ('kb','doc') AND NOT ("kb_links"."from_kind" = 'doc' AND "kb_links"."to_kind" = 'doc'))
);
--> statement-breakpoint
CREATE INDEX "kb_links_to_idx" ON "kb_links" USING btree ("to_kind","to_id");
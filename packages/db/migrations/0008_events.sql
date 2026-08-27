CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"type" text NOT NULL,
	"trace_id" text NOT NULL,
	"run_id" text,
	"conversation_id" text,
	"payload" jsonb NOT NULL,
	"enqueued" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_tenant_type_occurred_idx" ON "events" USING btree ("tenant_id","type","occurred_at");--> statement-breakpoint
CREATE INDEX "events_trace_idx" ON "events" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "events_pending_idx" ON "events" USING btree ("tenant_id","enqueued","occurred_at");
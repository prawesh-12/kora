ALTER TABLE "evaluations" ADD COLUMN "rubric_version" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "judge_model" text;--> statement-breakpoint
ALTER TABLE "evaluations" ADD COLUMN "judge_cost_usd_micros" bigint;
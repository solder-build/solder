CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"mint" varchar(44) NOT NULL,
	"sol_amount" text NOT NULL,
	"token_amount" text NOT NULL,
	"is_buy" boolean NOT NULL,
	"user" varchar(44) NOT NULL,
	"virtual_sol_reserves" text NOT NULL,
	"virtual_token_reserves" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

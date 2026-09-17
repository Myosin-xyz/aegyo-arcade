ALTER TABLE "competition_attempts" DROP CONSTRAINT "competition_attempt_game";--> statement-breakpoint
ALTER TABLE "competition_attempts" ADD CONSTRAINT "competition_attempt_game" CHECK ("competition_attempts"."game_id" IN ('snake','flappy','perfect-toss','hangman'));

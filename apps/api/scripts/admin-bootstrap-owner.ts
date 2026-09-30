import "reflect-metadata";
import { config } from "dotenv";
import { bootstrapOwner } from "../src/auth/bootstrap-owner.js";

config();

const result = await bootstrapOwner({
  email: process.env.ADMIN_BOOTSTRAP_EMAIL,
  password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
});

if (result.created) {
  console.log("Created OWNER admin user.");
} else {
  console.error("OWNER bootstrap refused: an admin user already exists.");
  process.exitCode = 1;
}

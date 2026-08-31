/**
 * WebSocket message contract between client/ and server/ (the Durable Object).
 * Both modules import this so message shapes can't drift during parallel implementation.
 * If a real implementation needs a field this doesn't have, ADD it here (don't shadow-type it
 * on one side only) and note the addition in your module's summary for integration.
 */

import type { WeaponId } from "./game-config";

export interface Vector2 {
  x: number;
  y: number;
}

export interface PlayerState {
  id: string;
  name: string;
  pos: Vector2;
  /** Facing/aim direction, unit vector — server computes this from auto-target, client renders it. */
  facing: Vector2;
  health: number;
  maxHealth: number;
  weapon: WeaponId;
  weaponLevel: number;
  money: number;
  alive: boolean;
  /** ms remaining before dash is available again; 0 = ready. */
  dashCooldownRemainingMs: number;
  /** true while mid-dash, so client can render the dash visual/afterimage. */
  isDashing: boolean;
}

export interface ProjectileState {
  id: string;
  ownerId: string;
  pos: Vector2;
  velocity: Vector2;
  weapon: WeaponId;
}

export interface MoneyPickupState {
  id: string;
  pos: Vector2;
  value: number;
}

export interface ShopZoneState {
  id: string;
  pos: Vector2;
  radius: number;
}

// ---- Client -> Server ----

export type ClientToServerMessage =
  | { type: "join"; name: string }
  | {
      type: "input";
      seq: number;
      /** Normalized joystick vector, magnitude 0..1. */
      moveVector: Vector2;
      dashPressed: boolean;
    }
  | { type: "buyWeaponLevel" }
  | { type: "chooseClass"; weapon: WeaponId };

// ---- Server -> Client ----

export type ServerToClientMessage =
  | { type: "joined"; playerId: string; matchCode: string }
  | { type: "error"; message: string }
  | {
      type: "state";
      tick: number;
      /** Server time in ms, for client-side interpolation. */
      serverTimeMs: number;
      players: PlayerState[];
      projectiles: ProjectileState[];
      pickups: MoneyPickupState[];
      shopZones: ShopZoneState[];
    }
  | { type: "death"; playerId: string; killerId: string | null; newLevel: number }
  | { type: "matchEnd"; winnerId: string | null; reason: "kills" | "timer" }
  | { type: "purchaseResult"; success: boolean; reason?: string };

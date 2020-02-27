import { RsBuffer } from '@server/net/rs-buffer';
import { world } from '@server/game-server';
import { Packet } from '@server/net/packet';
import { Npc } from '@server/world/actor/npc/npc';
import { Player } from '../player';
import { Position } from '@server/world/position';
import { QuadtreeKey } from '@server/world/world';
import { Actor } from '@server/world/actor/actor';

/**
 * Handles the registration of nearby NPCs or Players for the specified player.
 */
export function registerNewActors(packet: Packet, player: Player, trackedActors: Actor[], nearbyActors: QuadtreeKey[], registerActor: (actor: Actor) => void): void {
    if(trackedActors.length >= 255) {
        return;
    }

    // We only want to send about 20 new actors at a time, to help save some memory and computing time
    // Any remaining players or npcs will be automatically picked up by subsequent updates
    let newActors: QuadtreeKey[] = nearbyActors.filter(m1 => !trackedActors.includes(m1.actor));
    if(newActors.length > 50) {
        // We also sort the list of players or npcs here by how close they are to the current player if there are more than 80, so we can render the nearest first
        newActors = newActors
            .sort((a, b) => player.position.distanceBetween(a.actor.position) - player.position.distanceBetween(b.actor.position))
            .slice(0, 50);
    }

    for(const newActor of newActors) {
        const nearbyActor = newActor.actor;

        if(nearbyActor instanceof Player) {
            if(player.equals(nearbyActor)) {
                // Other player is actually this player!
                continue;
            }

            if(!world.playerExists(nearbyActor)) {
                // Other player is no longer in the game world
                continue;
            }
        } else if(nearbyActor instanceof Npc) {
            if(!world.npcExists(nearbyActor)) {
                // Npc is no longer in the game world
                continue;
            }
        }

        if(trackedActors.findIndex(m => m.equals(nearbyActor)) !== -1) {
            // Npc or other player is already tracked by this player
            continue;
        }

        if(!nearbyActor.position.withinViewDistance(player.position)) {
            // Player or npc is still too far away to be worth rendering
            // Also - values greater than 15 and less than -15 are too large, or too small, to be sent via 5 bits (max length of 32)
            continue;
        }

        // Only 255 players or npcs are able to be rendered at a time
        // To help performance, we limit it to 200 here
        if(trackedActors.length >= 255) {
            return;
        }

        registerActor(nearbyActor);
    }
}

/**
 * Handles updating of nearby NPCs or Players for the specified player.
 */
export function updateTrackedActors(packet: Packet, playerPosition: Position, appendUpdateMaskData: (actor: Actor) => void, trackedActors: Actor[], nearbyActors: QuadtreeKey[]): Actor[] {
    packet.writeBits(8, trackedActors.length); // Tracked actor count

    if(trackedActors.length === 0) {
        return [];
    }

    const existingTrackedActors: Actor[] = [];

    for(let i = 0; i < trackedActors.length; i++) {
        const trackedActor: Actor = trackedActors[i];
        let exists = true;

        if(trackedActor instanceof Player) {
            if(!world.playerExists(trackedActor as Player)) {
                exists = false;
            }
        } else {
            if(!world.npcExists(trackedActor as Npc)) {
                exists = false;
            }
        }

        if(exists && nearbyActors.findIndex(m => m.actor.equals(trackedActor)) !== -1
                && trackedActor.position.withinViewDistance(playerPosition)) {
            appendMovement(trackedActor, packet);
            appendUpdateMaskData(trackedActor);
            existingTrackedActors.push(trackedActor);
        } else {
            packet.writeBits(1, 1);
            packet.writeBits(2, 3);
        }
    }

    return existingTrackedActors;
}

/**
 * Applends movement data of a player or NPC to the specified updating packet.
 */
export function appendMovement(actor: Actor, packet: RsBuffer): void {
    if(actor.walkDirection !== -1) {
        // Actor is walking/running
        packet.writeBits(1, 1); // Update required

        if(actor.runDirection === -1) {
            // Actor is walking
            packet.writeBits(2, 1); // Actor walking
            packet.writeBits(3, actor.walkDirection);
        } else {
            // Actor is running
            packet.writeBits(2, 2); // Actor running
            packet.writeBits(3, actor.walkDirection);
            packet.writeBits(3, actor.runDirection);
        }

        packet.writeBits(1, actor.updateFlags.updateBlockRequired ? 1 : 0); // Whether or not an update flag block follows
    } else {
        // Did not move
        if(actor.updateFlags.updateBlockRequired) {
            packet.writeBits(1, 1); // Update required
            packet.writeBits(2, 0); // Signify the player did not move
        } else {
            packet.writeBits(1, 0); // No update required
        }
    }
}
'use strict';

var Primus = require('primus')
    , http = require('http');

var server = http.createServer()
    , primus = new Primus(server, { transformer: 'websockets' });

const socketTypes = {
    CREATE_ROOM: 'CREATE_ROOM',
    ROOM_CREATED: 'ROOM_CREATED',
    JOIN_ROOM: 'JOIN_ROOM',
    JOIN_ROOM_SUCCESS: 'JOIN_ROOM_SUCCESS',
    JOIN_ROOM_ERROR: 'JOIN_ROOM_ERROR',
    ADD_PLAYER: 'ADD_PLAYER',
    UPDATE_PLAYER: 'UPDATE_PLAYER',
    REMOVE_PLAYER: 'REMOVE_PLAYER',
    PLAYER_ADDED: 'PLAYER_ADDED',
    PLAYER_REMOVED: 'PLAYER_REMOVED',
    UPDATE_PLAYER_LIST: 'UPDATE_PLAYER_LIST',
    UPDATE_SCENE: 'UPDATE_SCENE',
    SCENE_UPDATED: 'SCENE_UPDATED',
    REACHED_GOAL: 'REACHED_GOAL',
    INIT: 'INIT',
    ERROR: 'ERROR',
}
console.log("Server started");

//primus.method does it to the entire server
//spark.method does it to the current connection
// a map of rooms -> users (tell us which users are in a room)
// the users is another map of connection ids -> player properties
let rooms = new Map();
// a map of users -> room (tells us which room a user is in)
let playerRoomMap = new Map();
// a map of all connections
let sparkMap = new Map();
primus.on('connection', (spark) => {
    console.log('new connection: ' + spark.id);
    spark.write({
        type: socketTypes.INIT,
        connectionId: spark.id
    });
    sparkMap.set(spark.id, spark);
    spark.on('data', (message) => {
        switch (message.type) {
            case socketTypes.CREATE_ROOM:
                handleRoomCreation(spark, message);
                break;
            case socketTypes.JOIN_ROOM:
                if (!handleRoomJoin(spark, message)) {
                    spark.write({
                        type: 'error',
                        message: 'error in player add'
                    });
                };
                break;
            case socketTypes.UPDATE_PLAYER:
                if (!handlePlayerUpdate(spark, message)) {
                    spark.write({
                        type: 'error',
                        message: 'error in player update'
                    });
                };
                break;
            case socketTypes.UPDATE_SCENE:
                if (!handleSceneUpdate(spark, message)) {
                    spark.write({
                        type: socketTypes.ERROR,
                        message: 'error in scene update'
                    })
                };
                break;
            case socketTypes.REACHED_GOAL:
                handleReachedGoal(spark);
                break;
            default:
                break;

        }
    });

    spark.on('end', function () {
        let playerId = spark.id;
        if (!playerRoomMap.has(playerId)) return;
        let playerRoom = playerRoomMap.get(playerId);
        if (!rooms.has(playerRoom)) return;
        //broadcast to the player's room that the player left
        rooms.get(playerRoom).forEach((value, key) => {
            let otherSpark = sparkMap.get(key);
            otherSpark.write({
                type: socketTypes.PLAYER_REMOVED,
                sparkId: spark.id
            });
        });
        // delete the player from local maps
        rooms.get(playerRoom).delete(playerId);
        playerRoomMap.delete(playerId);
        sparkMap.delete(spark.id);
        if (rooms.get(playerRoom).size === 0) {
            rooms.delete(playerRoom);
        }
    });

    //so the problem is how do you write to the players in the room
    // record their spark id I guess
    setInterval(() => {
        rooms.forEach((players, roomId) => {
            broadcastUpdatedProperties(players);
        });
    }, 16.7);

});

server.listen(443);
primus.save('primus.js');

function handleRoomCreation(spark, message) {
    let newRoom = generateRoomId();
    rooms.set(newRoom, new Map());
    let playerId = spark.id;
    let playerObject = message.player;
    rooms.get(newRoom).set(playerId, playerObject);
    playerRoomMap.set(playerId, newRoom);
    spark.write({
        type: socketTypes.ROOM_CREATED,
        roomId: newRoom
    });
}

function generateRoomId() {
    if (rooms.size >= 9000) return rooms.size() + 1;
    // generate a random room id from 1000 to 9999
    let max = 9999, min = 1000;
    let roomId = Math.floor(Math.random() * (max - min + 1) + min);
    while (rooms.has(roomId)) {
        roomId = Math.floor(Math.random() * (max - min + 1) + min);
    }
    return roomId;
}

function handleRoomJoin(spark, message) {
    let roomId = parseInt(message.roomId);
    let playerId = spark.id;
    let playerObject = message.player;
    if (!rooms.has(roomId)) return false;

    spark.write({
        type: socketTypes.JOIN_ROOM_SUCCESS,
        roomId
    });

    let currentRoom = rooms.get(roomId);
    currentRoom.set(playerId, playerObject);
    playerRoomMap.set(playerId, roomId);
    return true;
}

function handlePlayerUpdate(spark, message) {
    let roomId = playerRoomMap.get(spark.id);
    let newProperties = message.player;
    if (!rooms.has(roomId)) return false;

    let currentRoom = rooms.get(roomId);
    if (!currentRoom.has(spark.id)) return false;

    Object.assign(currentRoom.get(spark.id), newProperties);
    return true;
}

function handleSceneUpdate(spark, message) {
    let roomId = playerRoomMap.get(spark.id);
    if (!rooms.has(roomId)) return false;

    let currentRoom = rooms.get(roomId);
    if (!currentRoom.has(spark.id)) return false;

    currentRoom.forEach((value, sparkId) => {
        let connection = sparkMap.get(sparkId);
        connection.write({
            type: socketTypes.SCENE_UPDATED,
            scene: message.scene
        })
    });
    return true;
}

function broadcastUpdatedProperties(players) {
    // send each player's updated info to every player in the room
    let playerList = Array.from(players.values());
    players.forEach((value, otherSparkId) => {
        let connection = sparkMap.get(otherSparkId);
        connection.write({
            type: socketTypes.UPDATE_PLAYER_LIST,
            playerList
        });
    });
}

function handleReachedGoal(spark) {
    // broadcast that someone reached goal to entire room
    let roomId = playerRoomMap.get(spark.id);
    if (!rooms.has(roomId)) return false;

    let currentRoom = rooms.get(roomId);
    if (!currentRoom.has(spark.id)) return false;

    currentRoom.forEach((value, sparkId) => {
        let connection = sparkMap.get(sparkId);
        connection.write({
            type: socketTypes.REACHED_GOAL,
        })
    });
}
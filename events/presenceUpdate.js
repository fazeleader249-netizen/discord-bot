const { Events } = require('discord.js');
const { soundboard } = require('../config/config.js');
const path = require('path');

let dailyGreeting = new Map()
let dailyGoodbye = new Map()
module.exports = {
    name: Events.PresenceUpdate,
    execute(oldPresence, newPresence) {
        
        if ((!oldPresence || oldPresence.status === 'offline') && 
            newPresence.status === 'online') {
            handleUserOnline(newPresence);
        }
        
        if (oldPresence && oldPresence.status !== 'offline' && 
            newPresence.status === 'offline') {
            handleUserOffline(newPresence);
        }
    },
};

async function handleUserOnline(presence) {
    const user = presence.user;
    const guild = presence.guild;
    let date = new Date()
    //Check if user has a daily greeting
    console.log(date.getHours())
    //
    //Create greeting key
    console.log(dailyGreeting)
    const greetingKey = `${user.id} ${date.getDay()}-${date.getMonth()}`
    console.log(greetingKey)
    if (checkDaily(greetingKey, dailyGreeting)){
        return;
    }
    
    dailyGreeting.set(greetingKey, true)
    //
    const now = new Date();
    let time = now.getHours();
    time = time + 7 >= 24 ? time + 7 - 24: time + 7;
    let greeting = createGreeting(time)
    const generalChannel = guild.channels.cache.find(
        channel => channel.name === 'greeting'
    );
    
    if (generalChannel) {
        // await generalChannel.send(` ${greeting} <@${user.id}> nhóe 🐼`);
    }
    
}

async function handleUserOffline(presence) {
    const user = presence.user;
    const guild = presence.guild;
    const now = new Date();
    const hourVN = now.getUTCHours() + 7;
    const goodbyeKey = `${user.id} ${now.getDay()}-${now.getMonth()}`
    if (checkDaily(goodbyeKey, dailyGoodbye)){
        return;
    }
    dailyGoodbye.set(goodbyeKey, true)
    //
    
    // Tìm text channel để gửi tin nhắn tạm biệt
    const generalChannel = guild.channels.cache.find(
        channel => channel.name === 'greeting'
    );
    
    if (generalChannel) {
        // await generalChannel.send(` <@${user.id}> đã offline mịa rồiiii!`);
    }
}
//
function checkDaily(checkKey, listofDay){
    if (listofDay.size == 0) return false;
    for (const [key, value] of listofDay.entries()){
        if (key.includes(checkKey)){
            return true
        }
        
    }
    return false
}
//Create greeting
function createGreeting(hour){
    const morning = 11;
    const noon = 13; 
    const afternoon = 17;
    const night = 24;
    if (hour <= morning && hour >= 0){
        return "Chào buổi sáng";

    }
    if (hour <= noon){
        return "Chào buổi trưa"
    }
    if (hour <= afternoon){
        return "Chào buổi chiều"
    }
    if (hour <= night){
        return "Chào buổi tối"
    }
    return "Bot lỗi hihi"
    

}
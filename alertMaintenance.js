// This file defines functions to update previously sent alert notifications

const Discord = require('discord.js');
const got = require('got');
const alerts = require('./static/alerts.json');
const { serverNames } = require('./utils.js');

const popLevels = {
	1: "Dead",
	2: "Low",
	3: "Medium",
	4: "High",
	5: "Prime"
}

const winnerFaction = {
	1: "<:VS:818766983918518272> VS win",
	2: "<:NC:818767043138027580> NC win",
	3: "<:TR:818988588049629256> TR win",
}

const updateAlert = async function(info, pgClient, discordClient, isComplete){
	let messageEmbed = new Discord.MessageEmbed();
	messageEmbed.setTimestamp();
	messageEmbed.setFooter("Data from ps2alerts.com");
	let alertName = alerts[info.censusMetagameEventType].name;
	messageEmbed.setTitle(alertName);
	if (alertName.includes('Enlightenment')){
		messageEmbed.setColor('PURPLE');
	}
	else if (alertName.includes('Liberation')){
		messageEmbed.setColor('BLUE');
	}
	else if (alertName.includes('Superiority')){
		messageEmbed.setColor('RED');
	}
	messageEmbed.setDescription(`[${alerts[info.censusMetagameEventType].description}](https://ps2alerts.com/alert/${info.instanceId}?utm_source=auraxis-bot&utm_medium=discord&utm_campaign=partners)`);
	messageEmbed.addField("Server", serverNames[info.world], true);
	if(isComplete){
		messageEmbed.addField("Status", `Ended <t:${Math.floor(Date.parse(info.timeEnded)/1000)}:R>`, true);
	}
	else{
		const start = Date.parse(info.timeStarted);
		messageEmbed.addField("Status", `Started <t:${Math.floor(start/1000)}:t>\nEnds <t:${Math.floor((start+info.duration)/1000)}:R>`, true);
	}
	messageEmbed.addField("Population", `${popLevels[info.bracket]}`, true);
	try{
		messageEmbed.addField("Territory Control", `\
		\n<:VS:818766983918518272> **VS**: ${info.result.vs}%\
		\n<:NC:818767043138027580> **NC**: ${info.result.nc}%\
		\n<:TR:818988588049629256> **TR**: ${info.result.tr}%`, true);
	}
	catch(err){
		throw "Error displaying territory";
	}
	
	if(isComplete){
		if(info.result.draw){
			messageEmbed.addField("Result", "Draw", true);
		}
		else{
			messageEmbed.addField("Result", `${winnerFaction[info.result.victor]}`, true);
			const minutesDone = Math.floor((Date.now() - Date.parse(info.timeEnded))/60000);
			if (!(info.result.victor in winnerFaction) && minutesDone < 5){
				isComplete = false; //Don't delete from list, retry up to 5 minutes later when field may be populated
			}
		}
	}


	pgClient.query("SELECT messageID, channelID FROM alertMaintenance WHERE alertID = $1;", [info.instanceId])
	.then(rows => {
		for(let row of rows.rows){
			editMessage(messageEmbed, row.messageid, row.channelid, discordClient)
				.then(function(){
					if(isComplete){
						pgClient.query("DELETE FROM alertMaintenance WHERE alertID = $1;", [info.instanceId])
					}
				})
				.catch(err => {
					console.log("Error editing message");
					console.log(err)
				})
		}
	})
}

const editMessage = async function(embed, messageId, channelId, discordClient){
	try {
		const resChann = await discordClient.channels.fetch(channelId)

		if(resChann.deleted){
			return;
		}
		if (['GUILD_TEXT','GUILD_NEWS'].includes(resChann.type) && resChann.permissionsFor(resChann.guild.me).has(Discord.Permissions.FLAGS.VIEW_CHANNEL)) {
			const resMsg = await resChann.messages.fetch(messageId);
			await resMsg.edit({embeds: [embed]});
		}
		else if(resChann.type == 'DM'){
			const resMsg = await resChann.messages.fetch(messageId);
			await resMsg.edit({embeds: [embed]});
		}
	}
	catch(err) {
		// ignore, will be cleaned up on alert end
	}
}

const checkError = async function(row, pgClient, err){
	if(row.error){
		pgClient.query("DELETE FROM alertMaintenance WHERE alertID = $1;", [row.alertid]);
	}
	else{
		pgClient.query("UPDATE alertMaintenance SET error = true WHERE alertID = $1;", [row.alertid]);
		console.log(`Error retrieving alert info from PS2Alerts for alert ${row.alertid}`);
		console.log(err);
	}
}

module.exports = {
	update: async function(pgClient, discordClient){
		let rows = await pgClient.query("SELECT DISTINCT alertID, error FROM alertMaintenance");

		for(let row of rows.rows){
			got(`https://api.ps2alerts.com/instances/${row.alertid}`).json()
				.then(response => {
					updateAlert(response, pgClient, discordClient, "timeEnded" in response)
					.catch(err => {
						if(err == "Error displaying territory"){
							checkError(row, pgClient, err);
						}
						else{
							console.log("Error occurred when updating alert");
							console.log(err);
						}
					})
				})
				.catch(err => {
					checkError(row, pgClient, "Error during web request");
				});
			}
	}
}
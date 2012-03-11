var fs = require("fs");
var url = require("url");
var util = require("util");
var http = require("http");
var https = require('https');
var path = require("path");
var querystring = require('querystring');

var Bot = require("./lib/irc");
var Client = require("./lib/irc/client");

var Sol = require("./lib/sol");
var Sandbox = require("./lib/sandbox");
var FactoidServer = require("./lib/factoidserv");
var FeelingLucky = require("./lib/feelinglucky");

var Shared = require("./shared");
var Profile = require("./oftnbot-profile");

var Twitter = require("twitter");

String.prototype.repeat = function(i) {
	var d = '', t = this;
	while (i) {
		if (i & 1) {
			d += t;
		}
		t += t;
		i >>= 1;
	}
	return d;
};


var ΩF_0Bot = function(profile) {
	Bot.call(this, profile);
	
	this.sandbox = new Sandbox(path.join(__dirname, "oftnbot-utils.js"));
	this.factoids = new FactoidServer(path.join(__dirname, "oftnbot-factoids.json"));

	this.set_log_level(this.LOG_ALL);
	this.set_trigger("!"); // Exclamation
	
	this.start_github_server(9370);
	this.github_context = null;

	this.twitter = new Twitter(Profile.twitter);
};


util.inherits(ΩF_0Bot, Bot);

ΩF_0Bot.prototype.init = function() {
	Bot.prototype.init.call(this);

	this.register_listener(/^((?:sm?|v8?|js?|hs?|>>?|\|)>)([^>].*)+/, Shared.execute_js);
	this.register_command("topic", Shared.topic);
	this.register_command("find", Shared.find);
	this.register_command("learn", Shared.learn, {allow_intentions: false});
	this.register_command("forget", Shared.forget, {allow_intentions: false});
	this.register_command("commands", Shared.commands);
	this.register_command("tweet", this.tweet);
	this.register_command("g", Shared.google);
	this.register_command("gh", this.gh);

	this.password = "I solemnly swear that I am up to no evil";
	
	this.register_command("access", function(context, text) {
		if (context.priv && text === this.password) {
			context.sender.access = true;
			context.channel.send_reply(context.sender, "Access granted.");
		} else {
			context.channel.send_reply(context.sender, "Incorrect password.");
		}
	}, {hidden: true});

	this.register_listener(/^\x0F\x0F(.+)/, function(context, text, code) {
			var result;
			
			if (!context.sender.access) {
				var hours = 1000*60*60;
				var now = +new Date();

				if (now > context.sender.last_invocation + 3*hours ||
					typeof context.sender.last_invocation === "undefined") {

					context.channel.send_action ("scolds "+context.sender.name+" and puts them in a time out.");
					context.sender.last_invocation = now;

				}
				return;
			}
			
			try {
				with (context) {
					result = eval (code);
				}
			} catch (e) {
				context.channel.send_reply (context.sender, e);
				return;
			}
			if (result != null) {
				context.channel.send_reply (context.sender, require("./oftnbot-utils.js").pretty_print(result).substr(0, 400));
			}
	});
	
	this.countdown_timer = null;

	this.register_command("countdown", function(context, text) {
	
		var length, decrement, self = this;
		
		clearInterval(this.countdown_timer);
		
		length = 3;
		
		if (text !== "stop") { 
			this.countdown_timer = setInterval(function() {
				if (length) {
					context.channel.send(String(length+"..."));
				} else {
					context.channel.send("Go!");
					clearInterval(self.countdown_timer);
				}
				length--;
			}, 1000);
		}
	});
	
	this.on('invite', function(user, channel) {
		channel.join();
	});
	
	this.on('command_not_found', this.find);
	
	this.on('connect', function(client) {
		this.github_context = client;
	});
	
	this.register_command("choc", function(context) {
		var userlist = context.channel.userlist;

		try {
			if (context.priv) throw new Error("Cannot use command in private.");

			var authorized = ["alexgordon", "jeannicolas", "eboyjr", "locks", "CapsuleNZ"];
			if (!~authorized.indexOf(context.sender.name)) {
				throw new Error("You are not authorized to use this command.");
			}

			var client = http.createClient(80, "chocolatapp.com");
			var request = client.request ("GET",
				Profile.choc_invite,
				{ "host": "chocolatapp.com" });

			request.addListener("response", function(response) {
				response.setEncoding("utf8");
				var url = '';
				response.addListener('data', function(data) { url += data; });
				response.addListener('end', function() {
					// Send url
					context.channel.send_reply (context.intent, "An invite URL has been sent to you. Please check your private messages.");
					context.intent.send (url);
				});
			});
			request.end();
		} catch (e) {
			context.channel.send_reply (context.sender, e);
		}
	});

};


ΩF_0Bot.prototype.start_github_server = function(port) {

	http.createServer(function (request, response) {
		var chunks = [], channel;
		
		// Get the channel to send messages in from the url
		channel = url.parse(request.url).pathname.replace(/[^A-Z0-9\.]/ig, '').replace(/\./g, '#');
		if (!channel) {
			channel = "oftn";
		}
		channel = "#"+channel;
		
		request.setEncoding("utf8");
		request.on("data", function(chunk) {
			chunks.push(chunk);
		});
		
		// When the request has finished coming in.
		request.on("end", function() {
			var json = querystring.parse(chunks.join("")).payload, result = [], len;
			try {
				var data = JSON.parse(json);
				if (len = data.commits.length) {
					for (var i = 0; i < len; i++) {
						var author = data.commits[i].author;
						author = author.username || author.login || author.name || author.email;
						var commitmsg = data.commits[i].message.replace(/[\r\n]/g, ' ').replace(/^(.{64}).+$/, '$1…');
						result.push("\x036* "+data.repository.name+"\x0F "+commitmsg+" \x032<"+data.commits[i].url.slice(0, -33)+">\x0F\x0310 "+author+"\x0F");
					}
				}
			} catch (e) {}
			if (result.length) {
				if (this.github_context) {
					var chnl = this.github_context.get_channel(channel);
					for (var i = 0, len = result.length; i < len; i++) {
						chnl.send(result[i], {color: true});
					}
				}
			}
			response.end();
		}.bind(this));
	  
	}.bind(this)).listen(port);
	util.puts("Github server running at port: "+port);
};

ΩF_0Bot.prototype.find = function(context, text) {

	if (context.priv) {
		return Shared.find.call(this, context, text);
	}
	
	try {
		context.channel.send_reply(context.intent, this.factoids.find(text, true), {color: true});
	} catch(e) {
		// Factoid not found, do nothing.
	}
};

ΩF_0Bot.prototype.gh = function(context, username) {

	var options = {
		host: "api.github.com",
		path: "/users/" + username
	};

	https.get (options, function(res) {
		res.on ("data", function(json) {
			var data = JSON.parse (json);
			var reply = [];

			if (data.name)  reply.push (data.name);
			if (data.email) reply.push ("<"+data.email+">");
			if (data.html_url) reply.push ("| "+data.html_url+" |");
			if (data.blog)  reply.push (data.blog);
			if (data.location) reply.push ("("+data.location+")");

			if (data.created_at) {
				var d = new Date(data.created_at);
				var str = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + (d.getDate()+1) + ", " + d.getFullYear();
				reply.push ("- Member since: "+str);
			}

			if (data.public_repos) reply.push ("- " + data.public_repos + " public repo" + (data.public_repos-1?"s":""));

			context.channel.send_reply (context.intent, reply.join(" "));
		});
	}); 

};

ΩF_0Bot.prototype.tweet = function(context, text) {
	var username;
	var authorized = {
		"eboy": "eboyjr",
		"sephr": "sephr",
		"devyn": "devynci",
		"inimino": "inimino",
		"gkatsev": "gkatsev",
		"cloudhead": "cloudhead",
		"yrashk": "yrashk"
	};
	
	if (!authorized.hasOwnProperty (context.sender.name)) return;
	username = authorized[context.sender.name];

	if (text.length > 140) {
		context.channel.send_reply (context.sender, "Error: Status is over 140 characters. Get rid of at least "+(text.length-140)+" characters.");
		return;
	}

	this.twitter.updateStatus(text + " \u2014@" + username, function(data) {
		if (data.id_str) {
			context.channel.send ("Tweet successful: https://twitter.com/oftn_foundation/status/"+data.id_str);
		} else 
			var json = data.data;
			data = JSON.parse (json);{
			context.channel.send ("Error posting tweet: " + data.error);
		}
	});
};

new ΩF_0Bot(Profile).init();

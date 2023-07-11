//jshint esversion:6
// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
require('dotenv').config();//to get env variables from .env file
const express = require("express");//framework that provides broad features for building web and mobile applications
const bodyParser = require("body-parser");//for getting data from forms
const ejs = require("ejs");//for loading different pages using templates
const mongoose = require("mongoose");//library that creates a connection between MongoDB and the Node.js 
const session = require("express-session");//HTTP server-side framework used to create and manage a session middleware.
const passport = require("passport");//Passport's sole purpose is to authenticate requests
const passportLocalMongoose = require("passport-local-mongoose");//Passport-Local Mongoose is a Mongoose plugin that simplifies building username and password login with Passport.
const GoogleStrategy = require('passport-google-oauth20').Strategy;//This module lets you authenticate using Google in your Node.js applications
const findOrCreate = require("mongoose-findorcreate");//Finds a matching document, updates it according to the update arg, passing any options, and returns the found document (if any) to the callback
const http = require("http");//allows Node.js to transfer data over the Hyper Text Transfer Protocol (HTTP)
const socketio = require("socket.io");//enables real-time, bi-directional communication between web clients and servers
const formatMessage = require("./utils/messages");//decides how message should look in chatbox
const { userJoin, getCurrentUser, userLeave, getRoomUsers } = require("./utils/users");//shows live users
const nodemailer = require('nodemailer');//allows mailing
const path = require('path');//helps in fixing static folder i.e. where it should find the front end pages
const exphbs = require('express-handlebars');//same as ejs
const fetch = require("isomorphic-fetch");
const { Auth, LoginCredentials } = require("two-step-auth");//two factor authentication

const app = express();
const server = http.createServer(app);
const io = socketio(server);
const botName = "Bot";
var result;
var nickname;
var gmailID;

app.use(express.static("public"));

//Run when a client connects    
io.on("connection", socket => {
	// console.log('New WebSocket Connection');

	socket.on("joinRoom", ({ username, room }) => {
		nickname=username;
		User.updateOne({username:gmailID},{nick:nickname});
		
		const user = userJoin(socket.id, username, room);

		socket.join(user.room);
		// welcome current user
		socket.emit("message", formatMessage(botName, "Welcome to ChatCord"));
		// broadcast when a user connects
		socket.broadcast
			.to(user.room)
			.emit(
				"message",
				formatMessage(botName, `${user.username} has joined the chat`));

		// send users and room info
		io.to(user.room).emit("roomUsers", {
			room: user.room,
			users: getRoomUsers(user.room)
		})

	});
	// Runs when client disconnects
	socket.on("disconnect", () => {

		const user = userLeave(socket.id);
		if (user) {
			io.to(user.room).emit("message", formatMessage(botName, `${user.username} has left the chat`))
			// send users and room info
			io.to(user.room).emit("roomUsers", {
				room: user.room,
				users: getRoomUsers(user.room)
			})

		}

	})

	// listen for chatMessage
	socket.on("chatMessage", (msg) => {

		const user = getCurrentUser(socket.id)
		// console.log(msg);
		io.to(user.room).emit("message", formatMessage(user.username, msg));

	});
});
// view engine setup
// app.engine('handlebars',exphbs({ extname: "hbs", defaultLayout: false, layoutsDir: "views/ "}));
// app.set('view engine','handlebars');

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({
	extended: true
}));

//session management
const timeOut = 1000 * 60 * 60;
app.use(session({
	secret: "Our Little secret.",
	cookie: { maxAge: timeOut },
	resave: false,
	saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
mongoose.connect("mongodb://localhost:27017/IWPDB", { useNewUrlParser: true });

const userSchema = new mongoose.Schema({
	name: String,
	email: String,
	password: String,
	googleId: String
});


userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);
passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
	done(null, user.id);
});

passport.deserializeUser(function (id, done) {
	User.findById(id, function (err, user) {
		done(err, user);
	});
});
passport.use(new GoogleStrategy({
	clientID: process.env.CLIENT_ID,
	clientSecret: process.env.CLIENT_SECRET,
	callbackURL: "http://localhost:3000/auth/google/2fa",
	userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
},
	function (accessToken, refreshToken, profile, cb) {
		//   console.log(profile);
		User.findOrCreate({ googleId: profile.id }, function (err, user) {
			return cb(err, user);
		});
	}
));
app.get("/", function (req, res) {
	res.render("home");
});

app.get("/auth/google",
	passport.authenticate("google", { scope: ["profile"] })
);

app.get("/auth/google/2fa",
	passport.authenticate("google", { failureRedirect: "/login" }),
	function (req, res) {
		// Successful authentication, redirect home.
		res.redirect("/2fa");
	});

app.get("/login", function (req, res) {
	res.render("login");
});

app.get("/register", function (req, res) {
	res.render("register");
});

app.get("/2fa", function (req, res) {
	res.render("2fa");
});

app.post("/2fa", function (req, res) {
	otp = req.body.otp;
	console.log(result);
	// console.log(otp);
	// console.log(result+"is the otp");
	if (result == otp) {
		res.redirect("/2fa")
	}
	else {
		console.log("Wrong OTP");
		res.redirect("login");
	}
});

app.get("/secret", function (req, res) {
	if (req.isAuthenticated()) {
		res.render("secret");
	} else {
		res.redirect("login");
	}
});

app.get("/logout", function (req, res) {
	req.session.destroy(function (err) {
		res.redirect('/'); //Inside a callback… bulletproof!
	  });
	// req.logout();
	// res.redirect("/");
});

app.post("/register", function (req, res) {
	User.register({ uname: req.body.uname, username: req.body.username }, req.body.password, function (err, user) {
		if (err) {
			console.log(err);
			res.redirect("/register")
		} else {
			login2(req.body.username);

			passport.authenticate("local")(req, res, function () {
				// getting site key from client side
				const response_key = req.body["g-recaptcha-response"];
				// Put secret key here, which we get from google console
				const secret_key = process.env.CAPTCHA_SECRET_KEY;

				// Hitting POST request to the URL, Google will
				// respond with success or error scenario.
				const url =
					`https://www.google.com/recaptcha/api/siteverify?secret=${secret_key}&response=${response_key}`;

				// Making POST request to verify captcha
				fetch(url, {
					method: "post",
				})
					.then((response) => response.json())
					.then((google_response) => {

						// google_response is the object return by
						// google as a response
						if (google_response.success == true) {
							//   if captcha is verified
							res.redirect('/secret');
						} else {
							// if captcha is not verified
							res.redirect('/login');

						}
					})
					.catch((error) => {
						// Some error while verify captcha
						return res.json({ error });
					});
			});
		}

	});

});


app.post("/login", function (req, res) {
	// getting site key from client side
	const response_key = req.body["g-recaptcha-response"];
	// console.log(response_key);
	// Put secret key here, which we get from google console
	const secret_key = process.env.CAPTCHA_SECRET_KEY;

	// Hitting POST request to the URL, Google will
	// respond with success or error scenario.
	const url =
		`https://www.google.com/recaptcha/api/siteverify?secret=${secret_key}&response=${response_key}`;

	// Making POST request to verify captcha
	// fetch(url, {
	// 	method: "post",
	// })
	// 	.then((response) => response.json())
	// 	.then((google_response) => {

	// 		// google_response is the object return by
	// 		// google as a response
	// 		if (google_response.success == true) {
	// 			//   if captcha is verified
	// 			res.redirect('/secret');
	// 		} else {
	// 			// if captcha is not verified
	// 			res.redirect('/login');

	// 		}
	// 	})
	// 	.catch((error) => {
	// 		// Some error while verify captcha
	// 		return res.json({ error });
	// 	});
	
	const user = new User({
		username: req.body.username,
		password: req.body.password
	});
	gmailID=username;
	login2(req.body.username);

	req.login(user, function (err) {
		if (err) {
			console.log(err);

		} else {
			passport.authenticate("local")(req, res, function () {
				res.redirect("/secret");
			});

		}
	})
});

async function login2(emailId) {
	try {
		const res = await Auth(emailId, "IWP Project - ChatCord");
		// console.log(res);
		// console.log(res.mail);
		// console.log(res.OTP);
		// console.log(res.success);
		result = res.OTP;
	} catch (error) {
		console.log(error);
	}
}

server.listen(3000, function () {
	console.log("Server Started on Port 3000");
});

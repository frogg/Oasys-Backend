#!/usr/bin/env nodejs
require('dotenv').config()
const express = require('express')
const util = require('util');
const bodyParser = require('body-parser')
const mongo = require('./mongo.js');

const aws = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');

// Set S3 endpoint to DigitalOcean Spaces
const spacesEndpoint = new aws.Endpoint('nyc3.digitaloceanspaces.com');
const s3 = new aws.S3({
    endpoint: spacesEndpoint
});

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: 'oasys-space',
        acl: 'public-read',
        key: function (request, file, cb) {
            console.log(file);
            //Unique identifier
            cb(null, Date.now().toString());
        }
    })
}).array('upload', 1);

const app = express()

//Middleware for CORS
app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*,Content-Type,id");
    next();
});

// Middleware to parse JSON 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.get('/', (req, res) => {
    res.send('Documentation: https://docs.google.com/document/d/1aRe4420DifJNUmK-BPdQocBaC6b8LkowPVv4TJN0jJQ/edit?usp=sharing');
});

/*
Loads picture, title, description, tags, and url from "contents" db with published flag
*/


const gatherRatings = async function(data){
    const allRatingsAsync = data.map(async function(result){
        const {userId, contentId} = result;
        console.log("DATA", data);
        return await getRating(userId, contentId)
    });
    const allRatings = await Promise.all(allRatingsAsync);
    return allRatings
};

app.get('/GetContentsPreview', function (req, res) {
    mongo.GET.contentsPreview()
        .then(results => {
            gatherRatings(results)
                .then(ratings => {
                    //merge the average rating into the original results
                    results
                        .map((result, idx) => Object.assign(result, {rating: ratings[idx]}));
                    res.json(results)
                })
                .catch(err => {throw err})
        })
});


app.get('/user/:userId/:contentId', function (req, res) {
    const {userId, contentId} = req.params;
    mongo.GET.content(userId, contentId)
        .then(result => {
            console.log(`Read content from Mongo`)
            return res.json(result)
        })
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        });
});


/*
Loads avg rating of content from "ratings" db
*/
app.get('avgRating/:userId/:contentId', function (req, res) {

    userId = req.params.userId;
    contentId = req.params.contentId;


    getRating(userId, contentId, "", function (response, err) {
        console.log(response);
        res.json(response[0]);
    })

});

/*
Write rating for content into "ratings" db
*/
app.post('/rate/:userId/:contentId/:rating/:accessUser', function (req, res) {

    userId = req.params.userId;
    contentId = req.params.contentId;
    rating = req.params.rating;
    accessUser = req.params.accessUser;

    console.log("Test 1");

    mongo.WriteRatingToMongo(userId, contentId, rating, accessUser)
        .then(result => {
            console.log(`Write rating to mongo`)
            return res.json(result)
        })
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        });
});

/* 
Upload Unique Username into "users" db
*/
app.post('/newUsername/:userId/:username/', function (req, res) {

    userId = req.params.userId;
    username = req.params.username;

    mongo.uploadUsername(userId, username, function (result, err) {
        if (err) {
            console.log(err);
            res.end("Unexpected Error from Db");
        }

        else if (!result) {
            res.json({"userNameExists": true});
        }
        else {
            res.json({"userNameExists": false})
        }
    });

});

/*
Write data into to “contents” db
*/
app.post('/save/:userId/:contentId', function (req, res) {

    userId = req.params.userId;
    contentId = req.params.contentId;

    if (!req.body) {
        res.end("Error: Request body is empty.");
    }
    else if (req.body.published == 1) {
        if (!req.body.title || !req.body.description || !req.body.tags) {
            console.log("NOSIRE");
            res.end("You cannot publish unless you provide the picture url, title, description, and tags");
        }
        else {
            jsonBody = req.body;
            mongo.writeContentToMongo("publish", jsonBody, userId, contentId, function (result, err) {
                if (err) {
                    console.log(err);
                    res.end("Unexpected Error from Db");
                }
                else {
                    console.log(result);
                    res.send(result);
                }
            });
        }

    }
    else {
        console.log("STEP 4: NOT EXPECTED");
        jsonBody = req.body;
        mongo.writeContentToMongo("save", jsonBody, userId, contentId, function (result, err) {
            if (err) {
                console.log(err);
                res.end("Unexpected Error from Db");
            }
            else {
                console.log(result);
                res.send(result);
            }
        });
    }

});

/*
Helper function for calculating rating avg
*/
function getRating(userId, contentId, extra = "noExtra") {
    return new Promise(function (resolve, reject) {
        mongo.GET.ratingsForContent(userId, contentId)
            .then(result => {
                const sum = result.reduce((acc, val) => ({rating: acc.rating + val.rating})).rating;
                const average = result.length ? sum /result.length : 1.5
                resolve(average);
                //callback([average, extra, result.length])
            })
            .catch(err => {
                reject(err)
                throw err;
            })
    })
}

/*
Upload profile picture to "users" db
*/
app.post('/uploadProfilePic/:userId', function (request, response) {

    userId = request.params.userId;
    const files = request.files; // file passed from client
    const meta = request.data; // all other values passed from the client, like name, etc..

    console.log(files);
    console.log(meta);


    upload(request, response, function (error, success) {
        if (error) {
            console.log('uploadErr ', error);
            response.end('error" : "Update failed", "status" : 404');
        }
        console.log(request.files)
        console.log('File uploaded successfully.');

        var newUrl = request.files[0].location;

        mongo.uploadProfilePicture(userId, newUrl)
            .then(result => {
                console.log(`PROFILE picture uploaded!! `)
                return res.json(result)
            })
            .catch(err => {
                console.info(err)
                res.end("Unexpected Error from Db")
            });
    });
});

/*
Upload picture to "contents" db for cover photo
*/
app.post('/uploadTitle/:userId/:contentId', function (request, response) {

    userId = request.params.userId;
    contentId = request.params.contentId;

    upload(request, response, function (error, success) {
        if (error) {
            console.log(error);
            response.end('{"error" : "Update failed", "status" : 404}');
        }
        console.log(request.files)
        console.log('File uploaded successfully.');

        var newUrl = request.files[0].location;
        console.log('newURL here:  ', newUrl);

        mongo.uploadTitlePicture(userId, contentId, newUrl)
            .then(result => {
                console.log(`Title picture uploaded!! `)
                return res.json(result)
            })
            .catch(err => {
                console.info(err)
                res.end("Unexpected Error from Db")
            });
    });
});


/*
Get all information from "users" db
*/
app.get('/profile/:userId', function (request, response) {

    userId = request.params.userId;
    mongo.getProfile(userId).then(result => {
        console.log(`got profile info! `)
        return res.json(result)
    })
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        });
});

/*
Write data into to "analytics" db
*/

app.post('/saveUserContentAccess', function (req, res) {

    if (!req.body) {
        res.end("Error: Request body is empty.");
    }
    else {
        jsonBody = req.body;
        mongo.writeAnalyticsDataToMongo(jsonBody, function (result, err) {
            if (err) {
                console.log(err);
                res.end("Unexpected Error from Db");
            }
            else {
                console.log(result);
                res.send(result);
            }
        });
    }

});

/*
Get Analytics data for content from "analytics" db
*/
app.get('/getAllContentsForUser/:userId/', function (req, res) {
    userId = req.params.userId;
    mongo.readAnalyticsFromUsersMongo(userId)
        .then(result => res.json(result))
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        });
});

/*
Get Analytics data for content CREATOR from "analytics" db
*/
app.get('/getAllContentsForCreator/:userId/', function (req, res) {

    userId = req.params.userId;

    mongo.readAnalyticsFromCreatorMongo(userId)
        .then(result => res.json(result))
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        });
});


app.get('/getContentInfo/:userId/:contentId', function (req, res) {

    userId = req.params.userId;
    contentId = req.params.contentId;

    mongo.readAnalyticsFromContentsMongo(userId, contentId)
        .then(result => {
            console.log(res.json, "TYPE :", typeof res.json);
            return res.json(result)
        })
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        })
});


app.get('/getAllRatings/:userId', function (req, res) {
    const {userId} = req.params.userId;
    mongo.GET.allRatings(userId)
        .then(ratings => res.json(ratings))
        .catch(err => {
            console.info(err)
            res.end("Unexpected Error from Db")
        })
})


/*
Upload picture from quill to db
*/
app.post('/uploadQuillPic', function (request, response) {

    upload(request, response, function (error, success) {
        if (error) {
            console.log(error);
            response.end('{"error" : "Update failed", "status" : 404}');
        }
        console.log(request.files)
        console.log('File uploaded successfully.');

        var newUrl = request.files[0].location;
        console.log(newUrl);
        response.json(newUrl);
    });
});

//


app.listen(8080, () => console.log('Listening on port 8080'))

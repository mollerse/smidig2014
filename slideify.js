var fs = require('fs');

var slides = fs.readFileSync('./slides.html');
var title = 'Smidig 2014';

document.querySelector('.slides').innerHTML = slides;
document.querySelector('title').text = title;

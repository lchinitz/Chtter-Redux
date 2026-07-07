const { protocol, hostname, port } = window.location;
const baseURL = `${protocol}//${hostname}:${port}/`;

function init(){
    
    return;
}

async function build(){

    //Get the user name from the UI
    var userName = document.getElementById("userName").value;

    //Pass the user name to the API to find all contact information for this user
    var url = baseURL + `getContacts?userName=${userName}`;
    var theResult = await fetch(url,{method:'get'});
    var theJson = await theResult.json();

    //Make a set of sliders.  Order them alphabetically.
    var sliders = {};
    for (var entry of theJson) sliders[entry.contact_type] = entry.active;
    var theList = Object.keys(sliders);
    theList.sort();

    var theHTML = "";
    theHTML += `<table>`;
    for (var mode of theList){
	var theState = sliders[mode];
	theHTML += `<tr>`;
	theHTML += `<td> ${mode} </td>`;
	if (theState)
	    theHTML += `<td> <input type="checkbox" id="check_${mode}" checked onchange=modify("check_${mode}")> </td>`;
	else
	    theHTML += `<td> <input type="checkbox" id="check_${mode}" onchange=modify("check_${mode}")> </td>`;
	theHTML += `</tr>`;
    }
    theHTML += `</table>`;

    document.getElementById("div_selectors").innerHTML = theHTML;        
    document.getElementById("div_display").innerHTML = `<pre>${JSON.stringify(theJson,null,4)}</pre>`;
    
    return;
}

async function modify(item){

    var contact_type = item.replace("check_","");
    var contact_active = document.getElementById(item).checked;


    //Modify the item changed to reflect the change in the database
    var userName = document.getElementById("userName").value;

    var url = baseURL + `getContacts?userName=${userName}`;
    var theResult = await fetch(url,{method:'get'});
    var theJson = await theResult.json();
    var theEntry;
    for (var entry of theJson) if (entry.contact_type==contact_type) theEntry = entry;    

    var url = baseURL + `upsertContact?userName=${userName}&contactType=${contact_type}&contactValue=${theEntry.contact_value}&active=${contact_active}`;
    var theResult = await fetch(url,{method:'get'});
    var theJson = await theResult.json();
    
    build();
    
    return;
}


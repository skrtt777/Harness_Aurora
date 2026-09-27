import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(':memory:');
console.log('SQLite',db.prepare('select 42 as result').get());
const {createServer}=await import('./app/server.js');
const server=createServer({allowDev:false,centralSync:false});
server.listen(18787,'127.0.0.1',()=>console.log('Original Harness backend ready on Quest'));

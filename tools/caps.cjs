const X=require('xlsx');const dir=process.argv[2];
for(const id of [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30]){
 const f=`${dir}/cap${id}.xlsx`;let wb;try{wb=X.readFile(f)}catch(e){console.log(id,'MISSING');continue}
 const ws=wb.Sheets[wb.SheetNames[0]];const rows=X.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
 const marks=rows.map(r=>String(r[0]).trim()).filter(a=>/player|pitcher|dnp|total|injur|disabled|^[A-Z ]{4,}$/i.test(a));
 const n=rows.filter(r=>/^\$\d/.test(String(r[2]).trim())).length;
 console.log(id, JSON.stringify(String(rows[0][0]).trim()), rows[0][4], 'rows',rows.length,'salaried',n, '|', [...new Set(marks)].join(' / ').slice(0,300));
}

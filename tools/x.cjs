const X=require('xlsx');const f=process.argv[2];const wb=X.readFile(f);
for(const n of wb.SheetNames){const ws=wb.Sheets[n];console.log('### sheet',n,ws['!ref']);const rows=X.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});rows.slice(0,+process.argv[3]||45).forEach((r,i)=>console.log(i,JSON.stringify(r).slice(0,260)));}

import sys, collections
def tags(path):
    with open(path,'rb') as f: data=f.read().decode('utf-8',errors='replace')
    lines=data.splitlines()
    return [(int(lines[i].strip()), lines[i+1]) for i in range(0,len(lines)-1,2)]
def sections(t):
    secs={}; i=0
    while i<len(t):
        if t[i]==(0,'SECTION'):
            name=t[i+1][1]; j=i+2
            while t[j]!=(0,'ENDSEC'): j+=1
            secs[name]=(i+2,j); i=j
        i+=1
    return secs
def entities(t, a, b):
    ents=[]; cur=None
    for k in range(a,b):
        c,v=t[k]
        if c==0:
            cur={'type':v,'tags':[],'idx':k}; ents.append(cur)
        elif cur is not None: cur['tags'].append((c,v))
    return ents
def g(e,code,default=None):
    for c,v in e['tags']:
        if c==code: return v
    return default
def load(n):
    t=tags(n); s=sections(t)
    a,b=s['ENTITIES']; E=entities(t,a,b)
    return t,s,E
def points(E):
    rows=[];cur=None
    for e in E:
        if e['type']=='INSERT':
            cur={'e':e,'layer':g(e,8),'x':float(g(e,10)),'y':float(g(e,20)),'blk':g(e,2),'att':{}}; rows.append(cur)
        elif e['type']=='ATTRIB' and cur: cur['att'][g(e,2)]=g(e,1)
        elif e['type']=='SEQEND': cur=None
    return rows

"""Original procedural score. No samples, stock audio, or outside services."""
from pathlib import Path
import numpy as np
import wave

SR=48000
DURATION=15
BEAT=60/128
rng=np.random.default_rng(824)
mix=np.zeros((SR*DURATION,2),dtype=np.float64)

def add(at,signal,gain=1,pan=0):
    start=round(at*SR)
    if start<0:
        signal=signal[-start:];start=0
    n=min(len(signal),len(mix)-start)
    if n<=0:return
    angle=(pan+1)*np.pi/4
    mix[start:start+n,0]+=signal[:n]*gain*np.cos(angle)
    mix[start:start+n,1]+=signal[:n]*gain*np.sin(angle)

def kick(at,gain=.7):
    t=np.arange(int(.48*SR))/SR
    freq=45+110*np.exp(-t*38)
    phase=2*np.pi*np.cumsum(freq)/SR
    s=np.sin(phase)*np.exp(-t*10)*(1-np.exp(-t*1000))
    add(at,s,gain)

def hat(at,gain=.1,open=False,pan=0):
    t=np.arange(int((.19 if open else .07)*SR))/SR
    noise=rng.normal(size=len(t));noise=np.diff(noise,prepend=0)*.35
    s=noise*np.exp(-t*(23 if open else 75))*(1-np.exp(-t*1800))
    add(at,s,gain,pan)

def clap(at):
    t=np.arange(int(.19*SR))/SR
    noise=rng.normal(size=len(t))
    low=np.convolve(noise,np.ones(7)/7,mode='same')
    env=np.exp(-t*28)*(1-np.exp(-t*1100))
    add(at,(noise-low)*env,.13,.12)
    add(at,np.sin(2*np.pi*185*t)*np.exp(-t*32),.1)

def bass(at,midi,dur=.35,gain=.2):
    t=np.arange(int(dur*SR))/SR;f=440*2**((midi-69)/12)
    env=(1-np.exp(-t*70))*np.exp(-t*6)*np.minimum(1,(dur-t)*50)
    s=(np.sin(2*np.pi*f*t)+.23*np.sin(4*np.pi*f*t)+.1*np.sin(6*np.pi*f*t))*env
    add(at,s,gain)

def chime(at,midi,gain=.12,pan=0,dur=.55):
    t=np.arange(int(dur*SR))/SR;f=440*2**((midi-69)/12)
    env=(1-np.exp(-t*600))*np.exp(-t*7)*np.minimum(1,(dur-t)*50)
    s=(np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*f*2.002*t)+.08*np.sin(2*np.pi*f*3*t))*env
    add(at,s,gain,pan);add(at+BEAT*.75,s,gain*.21,-pan)

def whoosh(at,dur=.5,gain=.13,pan=0):
    t=np.arange(int(dur*SR))/SR
    n=rng.normal(size=len(t));n=np.convolve(n,np.ones(40)/40,mode='same')
    env=np.sin(np.pi*t/dur)**2
    add(at,n*env,gain*4,pan)

# A dry, syncopated pulse leaves the editorial cuts audible.
for b in range(26):
    at=b*BEAT
    if b not in (3,9,15,21):kick(at,.64 if b%4==0 else .47)
    if b%2:clap(at)
    hat(at+BEAT/2,.12,b%4==3,(-1 if b%2 else 1)*.5)
    if b>=4:
        hat(at+BEAT*.75,.055,False,.35)
        bass(at,[38,38,41,36][(b//4)%4],gain=.26)
        if b%4 in (1,2):bass(at+BEAT*.75,50,.16,.10)
    if b>=4 and b<22:
        chime(at+BEAT*.5,[74,77,81,72,69,77,74,81][b%8],.07,(-1 if b%2 else 1)*.55)

# Air and paper-like transitions precede exact picture cut times.
for b in [4,10,16,22,26]:
    whoosh(b*BEAT-.38,.52,.12,-.15)
    kick(b*BEAT,.7)
    chime(b*BEAT,62 if b<22 else 74,.12,.2,.8)
for b in [22,23,24]:
    bass(b*BEAT,38+(b-22)*3,.32,.24)
    whoosh(b*BEAT-.09,.17,.11,(b-23)*.5)

# Warm final chord and a soft low-frequency tail under the wordmark.
end=26*BEAT
for i,note in enumerate([50,57,62,65,69]):
    dur=15-end;t=np.arange(int(dur*SR))/SR;f=440*2**((note-69)/12)
    env=(1-np.exp(-t*11))*np.exp(-t*1.3)*np.minimum(1,(dur-t)*3)
    signal=(np.sin(2*np.pi*f*t)+.2*np.sin(2*np.pi*f*2*t))*env
    add(end,signal,.13,(i-2)*.3)
chime(end+.32,86,.15,.25,1.9)
whoosh(0,.5,.09)
kick(0,.8)

# Tape-like soft saturation, headroom, and a clean fade to digital silence.
mix=np.tanh(mix*1.2)
peak=np.max(np.abs(mix));mix*=.84/max(peak,.001)
fade=int(.5*SR);mix[-fade:]*=np.linspace(1,0,fade)[:,None]
mix[:240]*=np.linspace(0,1,240)[:,None]
pcm=(mix*32767).astype('<i2')
dest=Path(__file__).with_name('score.wav')
with wave.open(str(dest),'wb') as f:
    f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes(pcm.tobytes())
print(f'Original score: {dest}, 15.000 s, stereo 48 kHz, peak {20*np.log10(np.max(np.abs(mix))):.1f} dBFS')

# Making fake faces with ChatGPT for the face maker

The goal is a library of **fictional adult faces**, all shot the same way (front-on, even light, plain background), so the face
cutter can pull clean eyes, brows, nose, mouth and hair out of each one. They go into a **private** pack called `synthetic`.

## What to give ChatGPT
1. Upload **`face-template-silhouette.png`** (plain grey shapes, no writing) as a *placement reference*.
   (`face-template-guide.png` has labelled lines for you to read; don't upload that one, or the lines may end up in the pictures.)
2. Paste the **master prompt** below once at the start of a chat.
3. Then send one **face line** at a time, from the list further down, or your own. One image per message works best: the image
   generator keeps framing and lighting steadier than when you ask for several faces on one sheet.

## Master prompt (paste once)

> I'm building a library of fictional portrait photos. I'll send you one description per message, and you'll make one image each time.
> Every image must follow these rules exactly:
>
> - **Format:** square, 1024 by 1024 or larger. One person only.
> - **Subject:** a fictional adult, aged 25 to 70. Not a real person, not a celebrity, and not meant to look like anyone in particular.
> - **Framing:** use the uploaded grey silhouette only as a placement guide (do not draw it). Head and shoulders, facing the camera
>   straight on, head level and not tilted or turned, shoulders square. The face is centred and about 42% of the image width.
>   The eyes sit about 45% of the way down the image. A little of the neck and the tops of the shoulders show.
> - **Expression:** neutral and relaxed, mouth closed, looking straight into the lens. No smile, no teeth.
> - **Lighting:** soft, even, front-facing studio light, like a passport or ID photo. No strong shadows on the face, no coloured light,
>   no backlight, no dramatic contrast.
> - **Background:** one flat, plain, mid-grey colour. Nothing else in the frame.
> - **Face clear:** no glasses, no hat or hood, no jewellery on the face or ears, no hands, no scarf or high collar covering the jaw,
>   no hair over the eyes or the face. Both ears may be partly hidden by hair but the forehead, brows and cheeks must be visible.
> - **Clothing:** a plain, plain-coloured, round-neck top. No logos, no text, no patterns.
> - **Look:** a natural photograph with real skin texture, not a painting, not an illustration, not airbrushed or glossy, no filters.
>
> Reply with just the image each time. If a picture breaks one of these rules, make it again without asking.

## Face lines (send one per message)

Each line starts with a filename tag. After generating, **save the image with that name** (the letter at the front tells the importer the
gender: `m` masc, `f` femme, `a` androgynous). Example: `f-03-woman-fifties.png`.

Mix ages, skin tones, face shapes and hair so the library is varied. Edit freely.

| file name | description to send |
| --- | --- |
| `m-01-young-short-dark` | A man, about 26, light-olive skin, narrow face, short dark brown hair, clean-shaven. |
| `m-02-stubble-brown` | A man, about 35, medium-brown skin, square jaw, short black hair, light stubble. |
| `m-03-grey-beard` | A man, about 62, pale skin with freckles, round face, thinning grey hair, short grey beard. |
| `m-04-dark-curly` | A man, about 41, deep brown skin, oval face, short tight black curls, neat moustache. |
| `m-05-long-face-red` | A man, about 30, very pale skin, long face, short red hair, red-blond stubble. |
| `m-06-east-asian` | A man, about 48, East Asian features, wide face, short straight black hair with grey at the temples, clean-shaven. |
| `m-07-heavy` | A man, about 55, tan skin, full round face, bald on top with grey hair at the sides, grey moustache. |
| `m-08-south-asian` | A man, about 33, brown skin, angular face, thick black wavy hair, trimmed beard. |
| `m-09-blond` | A man, about 24, fair skin, soft jaw, medium-length blond hair, no facial hair. |
| `m-10-older-lined` | A man, about 69, weathered tan skin with deep lines, strong nose, short white hair, clean-shaven. |
| `f-01-young-long-dark` | A woman, about 25, light-brown skin, heart-shaped face, long straight dark hair, no make-up. |
| `f-02-fifties-grey-bob` | A woman, about 54, pale skin, oval face, silver-grey chin-length bob. |
| `f-03-curly-brown` | A woman, about 38, deep brown skin, round face, shoulder-length natural curly black hair. |
| `f-04-freckled-red` | A woman, about 29, fair freckled skin, narrow face, wavy copper-red hair to the shoulders. |
| `f-05-east-asian` | A woman, about 44, East Asian features, soft oval face, straight black hair just above the shoulders. |
| `f-06-blond-short` | A woman, about 33, fair skin, strong jaw, short cropped blond hair. |
| `f-07-older-white-hair` | A woman, about 68, pale lined skin, high cheekbones, white hair in a short wave. |
| `f-08-south-asian` | A woman, about 27, medium-brown skin, round face, long thick wavy black hair. |
| `f-09-middle-eastern` | A woman, about 40, olive skin, long face, dark brown hair in loose waves, strong brows. |
| `f-10-heavy-set` | A woman, about 50, tan skin, full face, shoulder-length straight chestnut hair with a fringe. |
| `a-01-androgynous-crop` | An androgynous adult, about 28, light skin, delicate features, short dark cropped hair. |
| `a-02-androgynous-long` | An androgynous adult, about 36, medium-brown skin, angular face, shoulder-length straight black hair. |
| `a-03-androgynous-curly` | An androgynous adult, about 31, deep brown skin, oval face, short dyed-blond tight curls. |
| `a-04-androgynous-older` | An androgynous adult, about 58, pale skin, long face, short grey hair. |

## When a picture is good enough

Keep it if all of these are true, otherwise ask for it again:
- Head straight and facing the camera, eyes open, mouth closed, nothing covering the face.
- Both eyes about level with the template's eye line, and the face roughly as wide as the template's oval.
- Even light on both sides of the face, plain grey background.
- Looks like a photograph: visible skin texture, not a smooth painting.

Things that go wrong, and what to say: *"Straighten the head, it's tilted."* / *"No smile, mouth closed."* /
*"Remove the glasses."* / *"Make the light flatter and more even."* / *"The background must be one flat grey."*

## Importing them

1. Put the saved images in `tools/pipeline/inbox/synthetic/`.
2. `python3 -I tools/pipeline/import_local.py --pack synthetic`
3. `node tools/cutter/headless.mjs --pack synthetic` (with `npm run cutter` running)
4. Review them at `http://127.0.0.1:5174/review.html?pack=synthetic`.

The pack is private and kept out of git and out of public builds.

## Notes
- AI-generated images may have unclear copyright, and the generator's own terms apply. That is why the pack is private.
- Faces are fictional, but any generator can by chance produce something close to a real person. The prompt says not to, and you
  should still glance at each face and drop any that look like someone you recognise.
- Only adults. Nothing under 25 in the prompt list; keep it that way.
